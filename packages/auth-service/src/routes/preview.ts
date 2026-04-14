/**
 * Preview routes for auth-service pages.
 *
 * Renders each auth-service page with fixture data and real CSS
 * injection, so client-app developers can iterate on their
 * `branding.css` without walking through the full OAuth flow each
 * time they want to see what a colour change looks like.
 *
 * Gated by `AUTH_PREVIEW_ROUTES=1`. Disabled by default; intended
 * for preview envs, dev instances, and `pr-base`. The trusted-clients
 * gate on CSS injection is preserved: a `client_id` passed via query
 * param gets its CSS injected only if it's on
 * `PDS_OAUTH_TRUSTED_CLIENTS`, exactly as in a real flow. Untrusted
 * clients still render the page but with no branding, which is what
 * real untrusted clients would see in production.
 *
 * Query params (all optional):
 *   ?client_id=<URL>   fetch branding CSS from this client_metadata,
 *                      subject to the trusted-clients check.
 *   ?error=<msg>       show error banner (exercises error-state CSS).
 */
import { Router, type Request, type Response } from 'express'
import { randomBytes } from 'node:crypto'
import type { AuthServiceContext } from '../context.js'
import { resolveClientMetadata, getClientCss } from '../lib/client-metadata.js'
import type { ClientMetadata } from '@certified-app/shared'
import { createLogger } from '@certified-app/shared'
import { renderLoginPage } from './login-page.js'
import { renderChooseHandlePage } from './choose-handle.js'
import { renderRecoveryForm, renderRecoveryOtpForm } from './recovery.js'

const logger = createLogger('auth:preview')

const FAKE_FLOW_ID = 'preview-flow-000000000000000000000000'
const FAKE_REQUEST_URI =
  'urn:ietf:params:oauth:request_uri:req-preview-0000000000000000'
const FAKE_EMAIL = 'alice@example.com'
const FAKE_HANDLE_DOMAIN = 'preview.example'

function fakeCsrfToken(): string {
  return randomBytes(16).toString('hex')
}

async function resolvePreviewBranding(
  clientId: string | undefined,
  trustedClients: string[],
): Promise<{ clientId: string; metadata: ClientMetadata; css: string | null }> {
  const defaultClientId = 'https://preview.example/client-metadata.json'
  if (!clientId) {
    return { clientId: defaultClientId, metadata: {}, css: null }
  }
  try {
    const metadata = await resolveClientMetadata(clientId)
    // Preview respects the real trusted-clients gate: CSS is only
    // injected when clientId is on PDS_OAUTH_TRUSTED_CLIENTS, exactly
    // as it is during a real OAuth flow. This keeps preview useful as
    // a pre-production check ("does my CSS actually load once I'm
    // added to the trusted list?") without letting arbitrary clients
    // inject CSS onto a preview instance just by being typed into a
    // URL.
    const css = getClientCss(clientId, metadata, trustedClients)
    return { clientId, metadata, css }
  } catch (err) {
    logger.warn({ err, clientId }, 'Preview: failed to resolve client metadata')
    return { clientId, metadata: {}, css: null }
  }
}

function renderIndex(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>auth-service previews</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; color: #222; }
    h1 { font-size: 22px; }
    p { line-height: 1.5; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
    ul { line-height: 2; }
    a { color: #0b5ed7; }
  </style>
</head>
<body>
  <h1>auth-service preview routes</h1>
  <p>Each link below renders one of the auth-service pages with fixture data, so you can iterate on your client's <code>branding.css</code> without going through a real OAuth flow.</p>
  <p>Pass <code>?client_id=&lt;URL-of-your-client-metadata.json&gt;</code> to inject that client's CSS. The trusted-clients check still applies: your client_id must be on <code>PDS_OAUTH_TRUSTED_CLIENTS</code> for its CSS to be injected, exactly as in a real OAuth flow. Untrusted clients still render the page but with no branding.</p>
  <ul>
    <li><a href="/preview/login">Login — email step</a></li>
    <li><a href="/preview/login-otp">Login — OTP step</a></li>
    <li><a href="/preview/choose-handle">Choose handle</a></li>
    <li><a href="/preview/choose-handle?error=Handle+already+taken">Choose handle (with error)</a></li>
    <li><a href="/preview/recovery">Recovery — email step</a></li>
    <li><a href="/preview/recovery-otp">Recovery — OTP step</a></li>
  </ul>
</body>
</html>`
}

export function createPreviewRouter(ctx: AuthServiceContext): Router {
  const router = Router()

  // Single gate: every route 404s unless the env flag is on. Checked
  // at each request rather than at mount time so the flag can flip
  // without a restart.
  router.use('/preview', (req, res, next) => {
    if (process.env.AUTH_PREVIEW_ROUTES !== '1') {
      res.status(404).send('Not Found')
      return
    }
    next()
  })

  router.get('/preview', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(renderIndex())
  })

  router.get('/preview/login', async (req: Request, res: Response) => {
    const { clientId, metadata, css } = await resolvePreviewBranding(
      req.query.client_id as string | undefined,
      ctx.config.trustedClients,
    )
    const html = renderLoginPage({
      flowId: FAKE_FLOW_ID,
      clientId,
      clientName: metadata.client_name || 'Preview Client',
      branding: metadata,
      customCss: css,
      loginHint: '',
      initialStep: 'email',
      otpAlreadySent: false,
      csrfToken: fakeCsrfToken(),
      authBasePath: '/api/auth',
      pdsPublicUrl: ctx.config.pdsPublicUrl,
      otpLength: ctx.config.otpLength,
      otpCharset: ctx.config.otpCharset,
    })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  })

  router.get('/preview/login-otp', async (req: Request, res: Response) => {
    const { clientId, metadata, css } = await resolvePreviewBranding(
      req.query.client_id as string | undefined,
      ctx.config.trustedClients,
    )
    const html = renderLoginPage({
      flowId: FAKE_FLOW_ID,
      clientId,
      clientName: metadata.client_name || 'Preview Client',
      branding: metadata,
      customCss: css,
      loginHint: FAKE_EMAIL,
      initialStep: 'otp',
      otpAlreadySent: true,
      csrfToken: fakeCsrfToken(),
      authBasePath: '/api/auth',
      pdsPublicUrl: ctx.config.pdsPublicUrl,
      otpLength: ctx.config.otpLength,
      otpCharset: ctx.config.otpCharset,
    })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  })

  router.get('/preview/choose-handle', async (req: Request, res: Response) => {
    const { css } = await resolvePreviewBranding(
      req.query.client_id as string | undefined,
      ctx.config.trustedClients,
    )
    const error =
      typeof req.query.error === 'string' ? req.query.error : undefined
    const html = renderChooseHandlePage(
      FAKE_HANDLE_DOMAIN,
      error,
      fakeCsrfToken(),
      true,
      css,
    )
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  })

  router.get('/preview/recovery', async (req: Request, res: Response) => {
    const { css } = await resolvePreviewBranding(
      req.query.client_id as string | undefined,
      ctx.config.trustedClients,
    )
    const error =
      typeof req.query.error === 'string' ? req.query.error : undefined
    const html = renderRecoveryForm({
      requestUri: FAKE_REQUEST_URI,
      csrfToken: fakeCsrfToken(),
      error,
      customCss: css,
      backUri: FAKE_REQUEST_URI,
    })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  })

  router.get('/preview/recovery-otp', async (req: Request, res: Response) => {
    const { css } = await resolvePreviewBranding(
      req.query.client_id as string | undefined,
      ctx.config.trustedClients,
    )
    const error =
      typeof req.query.error === 'string' ? req.query.error : undefined
    const html = renderRecoveryOtpForm({
      email: FAKE_EMAIL,
      csrfToken: fakeCsrfToken(),
      requestUri: FAKE_REQUEST_URI,
      otpLength: ctx.config.otpLength,
      otpCharset: ctx.config.otpCharset,
      error,
      customCss: css,
      backUri: FAKE_REQUEST_URI,
    })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html)
  })

  return router
}
