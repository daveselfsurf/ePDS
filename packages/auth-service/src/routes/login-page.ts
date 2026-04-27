/**
 * GET /oauth/authorize — unified login page
 *
 * Replaces the old authorize.ts → send-code.ts → verify-code.ts chain.
 *
 * Flow:
 *   1. Receive request from pds-core AS metadata redirect
 *      (?request_uri=...&client_id=...&prompt=...&login_hint=...)
 *   2. Create an auth_flow row (flow_id, request_uri, client_id)
 *   3. Set epds_auth_flow cookie (10 min, httpOnly)
 *   4. Render login page with:
 *      - Email OTP form (submits to better-auth /api/auth/* endpoints)
 *      - Social login buttons (only for configured providers)
 *      - "Recover with backup email" link
 *      - Client branding from OAuth metadata
 *
 * The better-auth flow after login:
 *   - Email OTP: user submits code to /api/auth/sign-in/email-otp/verify
 *   - Social: user clicks button → /api/auth/sign-in/{provider} → OAuth exchange
 *   - On success, better-auth redirects to /auth/complete (the bridge route)
 *   - Bridge reads epds_auth_flow cookie → auth_flow → HMAC-signed redirect
 */
import { Router, type Request, type Response } from 'express'
import { randomBytes } from 'node:crypto'
import type { AuthServiceContext } from '../context.js'
import {
  resolveClientMetadata,
  resolveClientName,
  getClientCss,
  type ClientMetadata,
} from '../lib/client-metadata.js'
import {
  escapeHtml,
  createLogger,
  resolveHandleMode as sharedResolveHandleMode,
  type HandleMode,
} from '@certified-app/shared'
import { socialProviders } from '../better-auth.js'
import { buildOtpInputProps } from '../otp-input.js'
import {
  resolveLoginHint,
  fetchParLoginHint,
} from '../lib/resolve-login-hint.js'
import { ensurePdsUrl } from '../lib/pds-url.js'
import { renderOptionalStyleTag } from '../lib/page-helpers.js'
import { renderError } from '../lib/render-error.js'
import {
  appendOrphanDeviceCookieClearHeaders,
  buildPdsAuthorizeRedirect,
  deriveSharedCookieDomain,
  hasOrphanDeviceCookie,
  readDeviceSessionCookies,
  shouldReuseSession,
} from '../lib/session-reuse.js'
import { fetchDeviceAccountEmails } from '../lib/fetch-device-accounts.js'

const logger = createLogger('auth:login-page')

const AUTH_FLOW_COOKIE = 'epds_auth_flow'
const AUTH_FLOW_TTL_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Reject URLs that aren't http(s) — keeps `javascript:` and other
 * exotic schemes out of the page when client metadata is read raw.
 */
function isSafeHttpUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

export async function safeResolveClientMetadata(
  clientId: string | undefined,
): Promise<ClientMetadata> {
  if (!clientId) return {}
  try {
    return await resolveClientMetadata(clientId)
  } catch (err) {
    // Degrade gracefully: no branding, handleMode falls back to null. user can still continue
    logger.error({ err, clientId }, 'Failed to resolve client metadata')
    return {}
  }
}

/**
 * Thin wrapper around the shared resolver that accepts a full `ClientMetadata`
 * object for ergonomics. The shared resolver takes the narrower
 * `epds_handle_mode` field because it is also called by pds-core, which only
 * has the same three-level precedence to apply.
 */
export function resolveHandleMode(
  queryParam: string | undefined,
  clientMeta: ClientMetadata,
): HandleMode {
  return sharedResolveHandleMode(queryParam, clientMeta.epds_handle_mode)
}

export function createLoginPageRouter(ctx: AuthServiceContext): Router {
  const router = Router()

  router.get('/oauth/authorize', async (req: Request, res: Response) => {
    const requestUri = req.query.request_uri as string | undefined
    const clientId = req.query.client_id as string | undefined
    const loginHint = req.query.login_hint as string | undefined
    if (!requestUri) {
      res
        .status(400)
        .type('html')
        .send(renderError('Missing request_uri parameter'))
      return
    }

    // HYPER-268: Cross-client OAuth session reuse.
    //
    // If a device session already exists in this browser (dev-id cookie
    // set on the shared parent domain by a previous sign-in via any
    // client), hand the flow straight to pds-core's upstream
    // /oauth/authorize. Upstream will then either auto-select the single
    // matching session (flow 1, login_hint matches) or render the
    // account chooser (flow 2, no hint).
    //
    // Flow 1 hint-vs-bindings gate: when login_hint resolves to an
    // email that is NOT bound to the current device, we skip the chooser
    // redirect and fall through to the email/OTP form. Otherwise the
    // chooser would either auto-select the wrong account (single
    // binding) or surface the hinted user's mailbox to a stranger
    // (multi-binding). Cookies are left intact so other accounts on the
    // device remain reusable on subsequent un-hinted visits.
    //
    // The prompt=login escape hatch (OIDC "force reauthentication") is
    // honoured inside shouldReuseSession — so the "Use a different
    // account" link on the chooser can redirect back here and force
    // the email form to render for a fresh sign-in.
    //
    // Requires pds-core and auth-service to share a parent domain
    // (AUTH_HOSTNAME ends with .<PDS_HOSTNAME>) so pds-core broadens
    // the dev-id cookie to that parent. On deployments with unrelated
    // hostnames (e.g. Railway preview envs) the cookie stays host-only
    // and this branch is a no-op.
    const sessionReuseReq = {
      cookies: (req as unknown as { cookies?: Record<string, string> }).cookies,
      headers: { cookie: req.headers.cookie },
      query: req.query as Record<string, unknown>,
    }

    // Resolve the login_hint up-front so we can decide whether the
    // device session is a match before redirecting to pds-core. The
    // resolution result is also reused below for the email/OTP form.
    const pdsInternalUrl = ensurePdsUrl(
      process.env.PDS_INTERNAL_URL,
      ctx.config.pdsPublicUrl,
    )
    const internalSecret = process.env.EPDS_INTERNAL_SECRET ?? ''

    let effectiveLoginHint = loginHint ?? null
    if (!effectiveLoginHint && requestUri) {
      effectiveLoginHint = await fetchParLoginHint(
        pdsInternalUrl,
        requestUri,
        internalSecret,
      )
    }
    const resolvedEmail = effectiveLoginHint
      ? await resolveLoginHint(
          effectiveLoginHint,
          pdsInternalUrl,
          internalSecret,
        )
      : null

    // Only fetch device-bound emails when we actually need them: the
    // cookie pair is present AND a hint resolved. Otherwise the existing
    // cookie-only reuse logic stands and the round trip to pds-core is
    // pure overhead.
    let deviceBoundEmails: string[] | null | undefined
    const cookiePair = readDeviceSessionCookies(sessionReuseReq)
    if (resolvedEmail && cookiePair) {
      deviceBoundEmails = await fetchDeviceAccountEmails(
        pdsInternalUrl,
        cookiePair.devId,
        cookiePair.sesId,
        internalSecret,
      )
    }

    if (
      shouldReuseSession(sessionReuseReq, {
        resolvedEmail,
        deviceBoundEmails,
      })
    ) {
      const target = buildPdsAuthorizeRedirect(
        ctx.config.pdsPublicUrl,
        req.query as Record<string, unknown>,
      )
      logger.info(
        { requestUri, clientId, target },
        'HYPER-268 session reuse: device session detected, redirecting to pds-core',
      )
      res.redirect(302, target)
      return
    }

    // Layer 1 cleanup: when exactly one of dev-id / ses-id is present,
    // the browser jar is in a divergent state that upstream's
    // DeviceManager cannot hydrate from. Emit Max-Age=0 clears for both
    // cookies in both host-only and shared-parent-domain scopes so the
    // next OAuth flow gets a clean slate — otherwise the orphan half
    // keeps bouncing through pds-core's welcome-page-guard every time.
    const orphan = hasOrphanDeviceCookie(sessionReuseReq)
    if (orphan.isOrphan) {
      const cookieDomain = deriveSharedCookieDomain(
        ctx.config.hostname,
        ctx.config.pdsHostname,
      )
      appendOrphanDeviceCookieClearHeaders(res, cookieDomain)
      logger.info(
        {
          requestUri,
          clientId,
          hasDevId: orphan.devId,
          hasSesId: orphan.sesId,
          cookieDomain,
        },
        'HYPER-268 orphan device cookie detected, clearing on email-form response',
      )
    }

    // Look up any existing flow for this request_uri early so we can fall back
    // to its stored clientId when the query string omits client_id (e.g. when
    // the user navigates back from the recovery page via a bare request_uri link).
    // The persisted flow's clientId takes precedence over the query-string
    // client_id — the flow was stored from a validated PAR request server-side,
    // whereas client_id on the query string is user-controlled.
    const existingFlow = ctx.db.getAuthFlowByRequestUri(requestUri)
    const effectiveClientId = existingFlow?.clientId ?? clientId ?? undefined

    const clientMeta = await safeResolveClientMetadata(effectiveClientId)
    const handleMode = resolveHandleMode(
      req.query.epds_handle_mode as string | undefined,
      clientMeta,
    )

    logger.debug(
      {
        requestUri: requestUri.slice(0, 60),
        loginHint: loginHint
          ? loginHint.replace(/(.{2})[^@]*(@.*)/, '$1***$2')
          : undefined,
        userAgent: req.headers['user-agent'],
        referer: req.headers['referer'],
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      },
      'GET /oauth/authorize',
    )

    // Idempotency: if a flow already exists for this request_uri, reuse it rather
    // than creating a second row (and triggering a second OTP send). This protects
    // against duplicate GETs from browser extensions, prefetch, or StayFocusd.
    let flowId: string
    if (existingFlow) {
      flowId = existingFlow.flowId
      logger.warn(
        {
          flowId,
          requestUri: requestUri.slice(0, 60),
          userAgent: req.headers['user-agent'],
          ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        },
        'Duplicate GET /oauth/authorize for existing request_uri — reusing flow, dropping duplicate',
      )
    } else {
      flowId = randomBytes(16).toString('hex')
      try {
        ctx.db.createAuthFlow({
          flowId,
          requestUri,
          clientId: clientId ?? null,
          handleMode,
          expiresAt: Date.now() + AUTH_FLOW_TTL_MS,
        })
      } catch (err) {
        logger.error({ err }, 'Failed to create auth_flow')
        res
          .status(500)
          .type('html')
          .send(renderError('Internal server error. Please try again.'))
        return
      }
    }

    // Set httpOnly cookie so /auth/complete can retrieve the flow_id
    res.cookie(AUTH_FLOW_COOKIE, flowId, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== 'development',
      sameSite: 'lax',
      maxAge: AUTH_FLOW_TTL_MS,
    })

    const clientName =
      clientMeta.client_name ??
      (effectiveClientId
        ? await resolveClientName(effectiveClientId)
        : 'an application')

    // CSS injection for trusted clients
    const customCss = effectiveClientId
      ? getClientCss(effectiveClientId, clientMeta, ctx.config.trustedClients)
      : null
    logger.debug(
      { clientId: effectiveClientId, trusted: customCss !== null },
      'client CSS trust check',
    )

    // Pillar 1 — State Determination: decide which step to render based on
    // login_hint presence. No method-assuming side effects in the GET handler.
    // The login_hint may be:
    //   a) On the query string as an email (from our demo app)
    //   b) On the query string as a handle/DID (unlikely but possible)
    //   c) Only in the stored PAR request (third-party apps that put the
    //      handle in the PAR body but don't duplicate it on the redirect URL)
    // The hint was already resolved above for the session-reuse decision; we
    // reuse `resolvedEmail` here rather than re-fetching.
    const hasLoginHint = !!resolvedEmail
    const initialStep = hasLoginHint ? 'otp' : 'email'

    // Pillar 3 — Idempotency (Option A): when this is a duplicate GET for an
    // existing flow (e.g. browser extension, StayFocusd), tell the client-side
    // script that OTP was already sent so it skips the auto-send.
    const otpAlreadySent = hasLoginHint && !!existingFlow

    logger.info(
      {
        flowId,
        clientId,
        requestUri: requestUri.slice(0, 50),
        reused: !!existingFlow,
        initialStep,
        otpAlreadySent,
      },
      'Serving login page for auth_flow',
    )

    // Use the resolved email (not the raw loginHint) for pre-filling forms.
    // This ensures handle-based hints get resolved to the correct email.
    const emailHint = resolvedEmail ?? ''

    res.type('html').send(
      renderLoginPage({
        flowId,
        clientId: effectiveClientId ?? '',
        clientName,
        branding: clientMeta,
        customCss,
        loginHint: emailHint,
        initialStep,
        otpAlreadySent,
        csrfToken: res.locals.csrfToken,
        authBasePath: '/api/auth',
        pdsPublicUrl: ctx.config.pdsPublicUrl,
        otpLength: ctx.config.otpLength,
        otpCharset: ctx.config.otpCharset,
      }),
    )
  })

  return router
}

export function renderLoginPage(opts: {
  flowId: string
  clientId: string
  clientName: string
  branding: ClientMetadata
  customCss: string | null
  loginHint: string
  initialStep: 'email' | 'otp'
  otpAlreadySent: boolean
  csrfToken: string
  authBasePath: string
  pdsPublicUrl: string
  otpLength: number
  otpCharset: 'numeric' | 'alphanumeric'
}): string {
  const b = opts.branding
  const appName = b.client_name || opts.clientName || 'Certified'
  const brandColor = b.brand_color || '#1A130F'
  const bgColor = b.background_color || '#F2EBE4'
  const logoHtml = b.logo_uri
    ? `<img src="${escapeHtml(b.logo_uri)}" alt="${escapeHtml(appName)}" class="client-logo">`
    : ''

  const inputProps = buildOtpInputProps(opts.otpLength, opts.otpCharset)

  // ATProto/Bluesky handle login button.
  //
  // Only rendered when the OAuth client declares `epds_handle_login_url` in
  // its client metadata. The button toggles the email form into handle-entry
  // mode; submitting a handle navigates the browser to that URL with
  // `?handle=<value>` appended. The client owns handle-to-PDS resolution
  // and starts a fresh OAuth flow against whichever PDS the handle resolves
  // to — auth-service is bound to one PDS and cannot PAR on the client's
  // behalf, so off-PDS handles only work via this hand-off.
  //
  // The URL is validated to be http(s) to prevent a malformed metadata
  // value from injecting a `javascript:` redirect target into the page.
  const handleLoginUrl = isSafeHttpUrl(b.epds_handle_login_url)
    ? (b.epds_handle_login_url as string)
    : ''
  const handleLoginButtonHtml = handleLoginUrl
    ? `<a href="#" class="btn-social btn-atproto">Or sign in with ATProto/Bluesky</a>`
    : ''

  const hasGoogle = 'google' in socialProviders
  const hasGithub = 'github' in socialProviders
  const hasSocialProviders = hasGoogle || hasGithub

  // Social login buttons — redirect to better-auth provider endpoints
  const socialButtonsHtml = hasSocialProviders
    ? `
    <div class="divider"><span>or continue with</span></div>
    <div class="social-buttons">
      ${
        hasGoogle
          ? `
      <a href="${opts.authBasePath}/sign-in/social?provider=google&callbackURL=/auth/complete" class="btn-social btn-google">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Sign in with Google
      </a>`
          : ''
      }
      ${
        hasGithub
          ? `
      <a href="${opts.authBasePath}/sign-in/social?provider=github&callbackURL=/auth/complete" class="btn-social btn-github">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
        </svg>
        Sign in with GitHub
      </a>`
          : ''
      }
    </div>
    <div class="divider"><span>or use email</span></div>
  `
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/static/favicon.svg" media="(prefers-color-scheme: light)" type="image/svg+xml">
  <link rel="icon" href="/static/favicon-dark.svg" media="(prefers-color-scheme: dark)" type="image/svg+xml">
  <title>Sign in to ${escapeHtml(appName)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: ${escapeHtml(bgColor)}; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { background: transparent; padding: 40px; max-width: 420px; width: 100%; text-align: center; }
    .client-logo { height: 80px; margin-bottom: 24px; display: block; margin-left: auto; margin-right: auto; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #1A130F; }
    .subtitle { color: #555; margin-bottom: 24px; font-size: 15px; line-height: 1.5; }
    .field { margin-bottom: 16px; text-align: left; }
    .field label { display: block; font-size: 14px; font-weight: 500; color: #333; margin-bottom: 6px; }
    .field input { width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; outline: none; background: white; }
    .field input:focus { border-color: ${escapeHtml(brandColor)}; }
    .otp-input { font-size: 28px !important; text-align: center; font-family: 'SF Mono', Menlo, Consolas, monospace !important; padding: 14px !important; }
    .otp-input:focus { border-color: ${escapeHtml(brandColor)} !important; }
    .btn-primary { width: 100%; padding: 12px; background: ${escapeHtml(brandColor)}; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 500; cursor: pointer; }
    .btn-primary:hover { opacity: 0.9; }
    .btn-primary:disabled { opacity: 0.7; cursor: not-allowed; }
    .btn-secondary { display: inline-block; margin-top: 12px; color: #555; background: none; border: none; font-size: 14px; cursor: pointer; text-decoration: underline; }
    .btn-social { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 10px 16px; border: 1px solid #ddd; border-radius: 8px; font-size: 15px; font-weight: 500; cursor: pointer; text-decoration: none; background: white; color: #333; margin-bottom: 8px; }
    .btn-social:hover { background: #f5f5f5; }
    .divider { display: flex; align-items: center; gap: 12px; margin: 16px 0; color: #888; font-size: 13px; }
    .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #ddd; }
    .error { color: #dc3545; background: #fdf0f0; padding: 12px; border-radius: 8px; margin: 12px 0; font-size: 14px; }
    .step-otp { display: none; }
    .step-otp.active { display: block; }
    .step-email.hidden { display: none; }
    .recovery-link { display: block; margin-top: 16px; color: #888; font-size: 13px; text-decoration: none; }
    .recovery-link:hover { color: #555; }
  </style>${renderOptionalStyleTag(opts.customCss)}
</head>
<body>
  <div class="container">
    ${logoHtml}
    <h1>Sign in</h1>
    <p class="subtitle">to use <strong>${escapeHtml(appName)}</strong></p>

    <div id="error-msg" class="error" style="display:none;"></div>

    ${socialButtonsHtml}

    <!-- Step 1: Email entry (calls better-auth sendOtp) -->
    <div id="step-email" class="step-email${opts.initialStep === 'otp' ? ' hidden' : ''}">
      <form id="form-send-otp">
        <div class="field">
          <label for="email">Email address</label>
          <input type="email" id="email" name="email" required autofocus
                 placeholder="you@example.com"
                 value="${escapeHtml(opts.loginHint)}">
        </div>
        <button type="submit" class="btn-primary">Continue with email</button>
      </form>
      ${handleLoginButtonHtml}
    </div>

    <!-- Step 2: OTP entry (calls better-auth verifyOtp) -->
    <div id="step-otp" class="step-otp${opts.initialStep === 'otp' ? ' active' : ''}">
      <p class="subtitle" id="otp-subtitle">${
        opts.initialStep === 'otp' && opts.otpAlreadySent
          ? `Code already sent to ${escapeHtml(opts.loginHint.replace(/(.{2})[^@]*(@.*)/, '$1***$2'))}`
          : ''
      }</p>
      <form id="form-verify-otp">
        <input type="hidden" id="otp-email" name="email" value="${escapeHtml(opts.loginHint)}">
        <div class="field">
          <label for="code">One-time code</label>
          <input type="text" id="code" name="code" required
                 maxlength="${opts.otpLength}" pattern="${inputProps.pattern}" inputmode="${inputProps.inputmode}"
                 autocomplete="one-time-code" placeholder="${inputProps.placeholder}" class="otp-input"
                 autocapitalize="${inputProps.autocapitalize}"
                  oninput="this.value=this.value.replace(/[\\s-]/g,'')"
                 style="letter-spacing: ${Math.max(2, Math.round(32 / opts.otpLength))}px">
        </div>
        <button type="submit" class="btn-primary">Verify</button>
      </form>
      <button type="button" class="btn-secondary" id="btn-resend">Resend code</button>
      <button type="button" class="btn-secondary" id="btn-back" style="margin-left: 8px;">Use different email</button>
    </div>

    <a href="/auth/recover?request_uri=${encodeURIComponent(opts.pdsPublicUrl + '/placeholder')}"
       class="recovery-link" id="recovery-link" style="display:${opts.initialStep === 'otp' ? 'block' : 'none'};">
      Recover with backup email
    </a>
  </div>

  <script>
    (function() {
      var authBasePath = ${JSON.stringify(opts.authBasePath)};
      var handleLoginUrl = ${JSON.stringify(handleLoginUrl)};
      var requestUri = ${JSON.stringify('')};  // not needed client-side; flow_id is in cookie
      var currentEmail = '';
      var loginMode = 'email'; // 'email' | 'handle'
      var errorEl = document.getElementById('error-msg');
      var stepEmail = document.getElementById('step-email');
      var stepOtp = document.getElementById('step-otp');
      var otpSubtitle = document.getElementById('otp-subtitle');
      var otpEmailInput = document.getElementById('otp-email');
      var recoveryLink = document.getElementById('recovery-link');
      var atprotoBtn = document.querySelector('.btn-atproto');
      var emailInput = document.getElementById('email');
      var emailLabel = document.querySelector('label[for="email"]');
      var sendOtpBtn = document.querySelector('#form-send-otp button[type=submit]');

      function showError(msg) {
        errorEl.textContent = msg;
        errorEl.style.display = 'block';
      }

      function clearError() {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
      }

      function setLoginMode(mode) {
        loginMode = mode;
        if (mode === 'handle') {
          emailLabel.textContent = 'Handle';
          emailInput.type = 'text';
          emailInput.placeholder = 'you.bsky.social';
          emailInput.name = 'handle';
          emailInput.value = '';
          // Browser's built-in type="email" validation would block valid
          // handles; remove it for handle mode.
          emailInput.removeAttribute('required');
          sendOtpBtn.textContent = 'Sign in';
          atprotoBtn.textContent = 'Or sign in with email';
        } else {
          emailLabel.textContent = 'Email address';
          emailInput.type = 'email';
          emailInput.placeholder = 'you@example.com';
          emailInput.name = 'email';
          emailInput.value = '';
          emailInput.setAttribute('required', '');
          sendOtpBtn.textContent = 'Continue with email';
          atprotoBtn.textContent = 'Or sign in with ATProto/Bluesky';
        }
        emailInput.focus();
        clearError();
      }

      if (atprotoBtn) {
        atprotoBtn.addEventListener('click', function(e) {
          e.preventDefault();
          setLoginMode(loginMode === 'email' ? 'handle' : 'email');
        });
      }

      var otpLength = ${opts.otpLength};
      var otpCharset = ${JSON.stringify(opts.otpCharset)};
      function showOtpStep(email) {
        currentEmail = email;
        otpEmailInput.value = email;
        var masked = email.replace(/(.{2})[^@]*(@.*)/, '$1***$2');
        otpSubtitle.textContent = 'We sent a ' + otpLength + (otpCharset === 'alphanumeric' ? '-character' : '-digit') + ' code to ' + masked;
        stepEmail.classList.add('hidden');
        stepOtp.classList.add('active');
        recoveryLink.style.display = 'block';
        document.getElementById('code').focus();
        clearError();
      }

      function showEmailStep() {
        stepOtp.classList.remove('active');
        stepEmail.classList.remove('hidden');
        recoveryLink.style.display = 'none';
        clearError();
      }

      // Send OTP via better-auth
      async function sendOtp(email) {
        try {
          var res = await fetch(authBasePath + '/email-otp/send-verification-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, type: 'sign-in' }),
          });
          if (!res.ok) {
            var data = await res.json().catch(function() { return {}; });
            return { error: data.message || data.error || 'Failed to send code' };
          }
          return { ok: true };
        } catch (err) {
          return { error: 'Network error. Please try again.' };
        }
      }

      // Verify OTP via better-auth and redirect
      async function verifyOtp(email, otp) {
        try {
          var res = await fetch(authBasePath + '/sign-in/email-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, otp: otp }),
          });
          if (!res.ok) {
            var data = await res.json().catch(function() { return {}; });
            return { error: data.message || data.error || 'Invalid code' };
          }
          // Success: redirect to /auth/complete to complete the AT Protocol flow
          window.location.href = '/auth/complete';
          return { ok: true };
        } catch (err) {
          return { error: 'Network error. Please try again.' };
        }
      }

      // Form: send OTP (email mode) or hand off to client (handle mode)
      document.getElementById('form-send-otp').addEventListener('submit', async function(e) {
        e.preventDefault();
        clearError();
        var raw = emailInput.value.trim();
        if (!raw) return;
        var btn = this.querySelector('button[type=submit]');
        var defaultLabel = loginMode === 'handle' ? 'Sign in' : 'Continue with email';
        btn.disabled = true;
        btn.textContent = loginMode === 'handle' ? 'Signing in...' : 'Sending...';

        if (loginMode === 'handle') {
          // Hand off to the client's handle-login URL with ?handle=<value>
          // appended (preserving any existing query string the client put on
          // the URL). The client resolves the handle to its PDS and starts a
          // fresh PAR against that PDS. handleLoginUrl is server-validated
          // as http(s) before being inlined here.
          var target = new URL(handleLoginUrl);
          target.searchParams.set('handle', raw);
          window.location.href = target.toString();
          return;
        }

        var email = raw.toLowerCase();
        var result = await sendOtp(email);
        btn.disabled = false;
        btn.textContent = defaultLabel;

        if (result.error) {
          showError(result.error);
        } else {
          showOtpStep(email);
        }
      });

      // Form: verify OTP
      document.getElementById('form-verify-otp').addEventListener('submit', async function(e) {
        e.preventDefault();
        clearError();
        var otp = document.getElementById('code').value.trim();
        var btn = this.querySelector('button[type=submit]');
        btn.disabled = true;
        btn.textContent = 'Verifying...';

        var result = await verifyOtp(currentEmail, otp);
        btn.disabled = false;
        btn.textContent = 'Verify';

        if (result && result.error) {
          showError(result.error);
        }
      });

      // Resend code
      document.getElementById('btn-resend').addEventListener('click', async function() {
        clearError();
        this.disabled = true;
        this.textContent = 'Sending...';
        var result = await sendOtp(currentEmail);
        this.disabled = false;
        this.textContent = 'Resend code';
        if (result.error) {
          showError(result.error);
        } else {
          showError('Code resent!');
          errorEl.style.color = '#28a745';
          errorEl.style.background = '#f0fff4';
        }
      });

      // Back to email step
      document.getElementById('btn-back').addEventListener('click', function() {
        showEmailStep();
        document.getElementById('code').value = '';
      });

      // Pillar 1: If login_hint was provided, the OTP step is already visible
      // server-side — no DOM transition needed.
      // Pillar 2: Auto-fire the OTP send as a client-side POST.
      // Pillar 3: Skip auto-send if this is a duplicate GET (otpAlreadySent).
      var loginHint = ${JSON.stringify(opts.loginHint)};
      var initialStep = ${JSON.stringify(opts.initialStep)};
      var otpAlreadySent = ${JSON.stringify(opts.otpAlreadySent)};

      if (initialStep === 'otp' && loginHint) {
        currentEmail = loginHint;
        var masked = loginHint.replace(/(.{2})[^@]*(@.*)/, '$1***$2');
        if (!otpAlreadySent) {
          // First load — fire the OTP send in the background.
          sendOtp(loginHint).then(function(result) {
            if (result.error) {
              showError(result.error);
            } else {
              otpSubtitle.textContent = 'We sent a ' + otpLength + (otpCharset === 'alphanumeric' ? '-character' : '-digit') + ' code to ' + masked;
            }
          });
        }
      }
    })();
  </script>
</body>
</html>`
}
