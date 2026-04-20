/**
 * In-browser email previews.
 *
 * Renders each of the transactional emails the auth-service sends
 * (new-user welcome/verify, returning-user sign-in OTP, backup-email
 * verification) inside a sandboxed iframe so operators and client-app
 * developers can see exactly what users will receive without hitting
 * SMTP or walking a real flow.
 *
 * The email HTML comes from the same pure builders the real sender uses
 * (`packages/auth-service/src/email/templates.ts`), so what's rendered
 * here is bit-for-bit what production would put in the envelope.
 *
 * Gated by `AUTH_PREVIEW_ROUTES=1` along with the rest of /preview/*.
 *
 * Query params (all optional):
 *   ?otp=<code>        override the fixture OTP (default: 123456).
 *   ?client_id=<URL>   render a client-branded template; subject to
 *                      the trusted-clients gate and the template's
 *                      `email_template_uri`. Falls back to the default
 *                      template if the client doesn't define one or
 *                      isn't trusted — mirrors real-sender behaviour.
 */
import { Router, type Request, type Response } from 'express'
import type { AuthServiceContext } from '../context.js'
import { escapeHtml } from '@certified-app/shared'
import {
  buildSignInCodeEmail,
  buildWelcomeCodeEmail,
  buildBackupEmailVerificationEmail,
  type RenderedEmail,
} from '../email/templates.js'

const FAKE_OTP = '123456'
const FAKE_TO = 'alice@example.com'
const FAKE_APP_NAME = 'Preview Client'
const FAKE_VERIFY_URL =
  'https://auth.preview.example/account/verify-backup?token=preview-token-0000'

function queryString(req: Request, name: string): string | undefined {
  const v = req.query[name]
  return typeof v === 'string' ? v : undefined
}

function sendHtml(res: Response, html: string): void {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.send(html)
}

function pdsIdentity(ctx: AuthServiceContext): {
  pdsName: string
  pdsDomain: string
} {
  return {
    pdsName: ctx.config.hostname,
    pdsDomain: ctx.config.pdsHostname,
  }
}

/**
 * Wrap a rendered email in a preview shell: from/to/subject headers and
 * an iframe with `srcdoc` so the email's CSS cannot bleed into — or read
 * from — the outer preview page.
 */
function renderEmailPreview(opts: {
  kind: string
  description: string
  fromName: string
  fromAddress: string
  to: string
  email: RenderedEmail
  backHref: string
}): string {
  const { kind, description, fromName, fromAddress, to, email, backHref } = opts
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Email preview — ${escapeHtml(kind)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 820px; margin: 24px auto; padding: 0 16px; color: #222; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .desc { color: #555; margin: 0 0 16px; }
    .back { font-size: 13px; }
    .headers { border: 1px solid #e5e7eb; border-radius: 8px 8px 0 0; background: #f8f9fa; padding: 12px 16px; }
    .headers dl { display: grid; grid-template-columns: max-content 1fr; column-gap: 12px; row-gap: 4px; margin: 0; font-size: 14px; }
    .headers dt { color: #666; font-weight: 500; }
    .headers dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
    iframe { width: 100%; height: 640px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; background: white; }
    details { margin-top: 16px; }
    summary { cursor: pointer; font-size: 14px; color: #0b5ed7; }
    pre { background: #f0f0f0; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
  </style>
</head>
<body>
  <p class="back"><a href="${escapeHtml(backHref)}">&larr; Back to previews</a></p>
  <h1>${escapeHtml(kind)}</h1>
  <p class="desc">${escapeHtml(description)}</p>
  <div class="headers">
    <dl>
      <dt>From</dt><dd>${escapeHtml(fromName)} &lt;${escapeHtml(fromAddress)}&gt;</dd>
      <dt>To</dt><dd>${escapeHtml(to)}</dd>
      <dt>Subject</dt><dd>${escapeHtml(email.subject)}</dd>
    </dl>
  </div>
  <iframe
    title="Rendered email body"
    sandbox=""
    srcdoc="${escapeHtml(email.html)}"></iframe>
  <details>
    <summary>Plain-text alternative</summary>
    <pre>${escapeHtml(email.text)}</pre>
  </details>
</body>
</html>`
}

export function createPreviewEmailsRouter(ctx: AuthServiceContext): Router {
  const router = Router()

  // Match the gate in createPreviewRouter: /preview/* is 404 unless the
  // flag is on. Checked per-request so the flag can flip without a restart.
  router.use('/preview/emails', (_req, res, next) => {
    if (process.env.AUTH_PREVIEW_ROUTES !== '1') {
      res.status(404).send('Not Found')
      return
    }
    next()
  })

  const fromName = ctx.config.email.fromName
  const fromAddress = ctx.config.email.from

  const render = (
    req: Request,
    kind: string,
    description: string,
    email: RenderedEmail,
  ): string =>
    renderEmailPreview({
      kind,
      description,
      fromName,
      fromAddress,
      to: queryString(req, 'to') ?? FAKE_TO,
      email,
      backHref: '/preview',
    })

  router.get('/preview/emails/new-user', (req: Request, res: Response) => {
    const code = queryString(req, 'otp') ?? FAKE_OTP
    const email = buildWelcomeCodeEmail({ code, ...pdsIdentity(ctx) })
    sendHtml(
      res,
      render(
        req,
        'New user — welcome / email verification',
        'Sent when a user signs up. Contains the OTP they enter to confirm their email and finish creating their account.',
        email,
      ),
    )
  })

  router.get(
    '/preview/emails/returning-user',
    (req: Request, res: Response) => {
      const code = queryString(req, 'otp') ?? FAKE_OTP
      const email = buildSignInCodeEmail({
        code,
        clientAppName: queryString(req, 'app') ?? FAKE_APP_NAME,
        ...pdsIdentity(ctx),
      })
      sendHtml(
        res,
        render(
          req,
          'Returning user — sign-in OTP',
          'Sent when an existing user signs in to a client app. Contains the OTP they enter to complete the sign-in.',
          email,
        ),
      )
    },
  )

  router.get('/preview/emails/recovery', (req: Request, res: Response) => {
    const email = buildBackupEmailVerificationEmail({
      verifyUrl: queryString(req, 'verify_url') ?? FAKE_VERIFY_URL,
      ...pdsIdentity(ctx),
    })
    sendHtml(
      res,
      render(
        req,
        'Account recovery — backup email verification',
        'Sent when a user adds a backup email to their account. Contains the link they click to prove they control the address.',
        email,
      ),
    )
  })

  return router
}
