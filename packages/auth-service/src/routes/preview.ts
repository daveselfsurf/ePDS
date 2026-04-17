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
import {
  createLogger,
  getClientMetadataCacheStatus,
  PREVIEW_CACHE_STATUS_HTML,
  PREVIEW_CLIENT_ID_INPUT_HTML,
  PREVIEW_CLIENT_ID_SCRIPT_HTML,
  renderPreviewLinksSections,
  validateClientMetadataForPreview,
  type ClientMetadata,
} from '@certified-app/shared'
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

/**
 * Turn a bare hostname (e.g. `auth.localhost`, `auth.pds.example`) into
 * an absolute origin. `localhost` (and `*.localhost`) uses http; anything
 * else uses https. This mirrors how the rest of the codebase treats the
 * `*_HOSTNAME` vars — see packages/pds-core/src/index.ts where `pdsUrl`
 * is built the same way from `PDS_HOSTNAME`.
 */
function hostnameToUrl(hostname: string): string {
  const scheme =
    hostname === 'localhost' || hostname.endsWith('.localhost')
      ? 'http'
      : 'https'
  return `${scheme}://${hostname}`
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
    // Preview routes always bypass the 10-minute cache so devs see
    // branding.css edits on the next refresh.
    const metadata = await resolveClientMetadata(clientId, { noCache: true })
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

function renderIndex(opts: {
  authPublicUrl: string
  pdsPublicUrl: string
}): string {
  const linksHtml = renderPreviewLinksSections({
    currentService: 'auth',
    authPublicUrl: opts.authPublicUrl,
    pdsPublicUrl: opts.pdsPublicUrl,
  })
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>auth-service previews</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 768px; margin: 40px auto; padding: 0 16px; color: #222; }
    h1 { font-size: 22px; }
    h2 { font-size: 16px; margin: 24px 0 4px; }
    p { line-height: 1.5; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
    ul { line-height: 2; }
    a { color: #0b5ed7; }
    label { display: block; margin: 16px 0 6px; font-weight: 500; }
    input[type="url"] { width: 100%; padding: 8px 10px; font-size: 14px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    input[type="url"]:focus { outline: 2px solid #0b5ed7; outline-offset: -1px; border-color: transparent; }
    .preview-group { margin-top: 16px; }
    .cache-status { margin-top: 32px; padding: 12px 16px; background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 8px; }
    .cache-status h2 { font-size: 15px; margin: 0 0 4px; }
    .cache-status-hint { font-size: 13px; color: #555; margin: 0 0 8px; }
    .cache-entries { list-style: none; padding: 0; margin: 0; }
    .cache-entry { display: flex; align-items: center; gap: 10px; padding: 4px 0; min-width: 0; }
    .cache-entry-url { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
    .cache-entry-ttl { flex: 0 0 auto; font-variant-numeric: tabular-nums; font-weight: 500; color: #444; font-size: 13px; }
    .cache-entry-preview { flex: 0 0 auto; padding: 2px 10px; font-size: 12px; border: 1px solid #cbd5e1; border-radius: 4px; background: white; cursor: pointer; color: #0b5ed7; }
    .cache-entry-preview:hover { background: #eff6ff; border-color: #0b5ed7; }
    .validation { margin-top: 8px; }
    .validation-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
    .validation-row { display: grid; grid-template-columns: 1.25em auto 1fr; column-gap: 8px; align-items: baseline; font-size: 14px; }
    .validation-label { font-weight: 500; }
    .validation-detail { color: #555; font-size: 13px; }
    .validation-ok .validation-label { color: #15803d; }
    .validation-warn .validation-label { color: #b45309; }
    .validation-error .validation-label { color: #b91c1c; }
    .validation-loading, .validation-error-inline { font-size: 13px; color: #555; margin: 6px 0 0; }
  </style>
</head>
<body>
  <h1>auth-service preview routes</h1>
  <p>Each link below renders one of the ePDS preview pages with fixture data, so you can iterate on your client's <code>branding.css</code> without going through a real OAuth flow. Routes from both services are listed here; links under <em>pds-core</em> point to the other service and don't pick up the client-metadata URL below — enter it once per service.</p>
  ${PREVIEW_CLIENT_ID_INPUT_HTML}
  ${linksHtml}
  <p>The trusted-clients check still applies: your URL must be on <code>PDS_OAUTH_TRUSTED_CLIENTS</code> for its CSS to be injected, exactly as in a real OAuth flow. Leave the field blank to render the pages unbranded.</p>
  <p>Alternatively, skip the field and append <code>?client_id=&lt;URL-of-your-client-metadata.json&gt;</code> to any of the links above.</p>
  ${PREVIEW_CACHE_STATUS_HTML}
  ${PREVIEW_CLIENT_ID_SCRIPT_HTML}
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

  // Cross-links on the index go to the sibling pds-core service on the
  // base PDS domain. Derive absolute URLs from the hostnames: the
  // auth-service runs on auth.<PDS_HOSTNAME> and pds-core on the bare
  // <PDS_HOSTNAME>, matching the Caddyfile and setup.sh layout.
  const authPublicUrl = hostnameToUrl(ctx.config.hostname)
  const pdsPublicUrl = ctx.config.pdsPublicUrl

  router.get('/preview', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(renderIndex({ authPublicUrl, pdsPublicUrl }))
  })

  router.get('/preview/cache-status', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      now: Date.now(),
      entries: getClientMetadataCacheStatus(),
    })
  })

  router.get('/preview/validate', async (req: Request, res: Response) => {
    const url =
      typeof req.query.client_id === 'string' ? req.query.client_id : ''
    res.setHeader('Cache-Control', 'no-store')
    if (!url) {
      res.json({ url: '', fetched: false, checks: [] })
      return
    }
    const result = await validateClientMetadataForPreview(
      url,
      ctx.config.trustedClients,
    )
    res.json(result)
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
