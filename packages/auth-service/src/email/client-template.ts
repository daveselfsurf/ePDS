/**
 * Client-branded email template resolution.
 *
 * When an OAuth client advertises `email_template_uri` (and optionally
 * `email_subject_template`) in its client metadata, we fetch the remote
 * template and substitute `{{code}}`, `{{app_name}}`, `{{logo_uri}}`,
 * `{{email}}`, plus conditional `{{#is_new_user}}...{{/is_new_user}}`
 * blocks. The real sender and the /preview/emails/* routes both go
 * through `buildClientBrandedEmail` so what the browser previews
 * matches what production will actually put in the envelope.
 */
import {
  createLogger,
  escapeHtml,
  formatOtpPlain,
  makeSafeFetch,
} from '@certified-app/shared'
import { resolveClientMetadata } from '../lib/client-metadata.js'
import type { RenderedEmail } from './templates.js'

const logger = createLogger('auth:email-template')

const MAX_TEMPLATE_SIZE = 100_000 // 100KB
const TEMPLATE_CACHE_TTL = 10 * 60 * 1000 // 10 minutes

const templateCache = new Map<string, { html: string; fetchedAt: number }>()

/** Seed the template cache. Intended for tests only. */
export function _seedTemplateCacheForTest(uri: string, html: string): void {
  templateCache.set(uri, { html, fetchedAt: Date.now() })
}

/** Clear the template cache. Intended for tests only. */
export function _clearTemplateCacheForTest(): void {
  templateCache.clear()
}

// SSRF-hardened fetch for email templates: HTTPS-only, no private IPs,
// 5s timeout, 100KB body cap.
const safeFetch = makeSafeFetch({
  timeoutMs: 5_000,
  maxBodyBytes: MAX_TEMPLATE_SIZE,
})

export async function fetchTemplate(uri: string): Promise<string | null> {
  const allowedDomains = process.env.EMAIL_TEMPLATE_ALLOWED_DOMAINS
  if (allowedDomains) {
    try {
      const domains = allowedDomains.split(',').map((d) => d.trim())
      const hostname = new URL(uri).hostname
      if (!domains.includes(hostname)) {
        logger.warn(
          { uri, hostname },
          'Email template domain not in allowlist, ignoring',
        )
        return null
      }
    } catch {
      return null
    }
  }

  const cached = templateCache.get(uri)
  if (cached && Date.now() - cached.fetchedAt < TEMPLATE_CACHE_TTL) {
    return cached.html
  }
  try {
    const res = await safeFetch(uri)
    if (!res.ok) return null

    const html = await res.text()
    if (html.length > MAX_TEMPLATE_SIZE) {
      logger.warn(
        { uri, size: html.length },
        'Email template too large, ignoring',
      )
      return null
    }

    if (!html.includes('{{code}}')) {
      logger.warn(
        { uri },
        'Email template missing {{code}} placeholder, ignoring',
      )
      return null
    }
    templateCache.set(uri, { html, fetchedAt: Date.now() })
    return html
  } catch (err) {
    logger.warn({ err, uri }, 'Failed to fetch email template')
    return null
  }
}

export function renderTemplate(
  template: string,
  vars: Record<string, string | boolean>,
): string {
  let html = template

  // Conditional sections first: {{#key}}...{{/key}} and {{^key}}...{{/key}}
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === 'boolean') {
      const showRegex = new RegExp(
        `\\{\\{#${key}\\}\\}([\\s\\S]*?)\\{\\{/${key}\\}\\}`,
        'g',
      )
      const hideRegex = new RegExp(
        `\\{\\{\\^${key}\\}\\}([\\s\\S]*?)\\{\\{/${key}\\}\\}`,
        'g',
      )
      html = html.replace(showRegex, value ? '$1' : '')
      html = html.replace(hideRegex, value ? '' : '$1')
    }
  }

  // String variables, HTML-escaped.
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === 'string') {
      html = html.replaceAll(`{{${key}}}`, escapeHtml(value))
    }
  }

  return html
}

export function renderSubjectTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  let subject = template
  for (const [key, value] of Object.entries(vars)) {
    subject = subject.replaceAll(`{{${key}}}`, value)
  }
  return subject
}

/**
 * Resolve a client's email-branding metadata, fetch the remote template,
 * and render `{ subject, text, html, fromName }`. Returns null when the
 * client isn't trusted, has no branded template, the fetch fails, or
 * the template is invalid — the caller is expected to fall back to the
 * default.
 *
 * Only clients on `trustedClients` are honoured: an untrusted `client_id`
 * could otherwise cause an outbound fetch to an attacker-controlled URL
 * and put attacker-authored HTML alongside the PDS's own `From:`
 * address. This matches the gate on `EmailSender.sendOtpCode` and on
 * CSS branding injection.
 */
export async function buildClientBrandedEmail(opts: {
  clientId: string
  code: string
  isNewUser: boolean
  toEmail: string
  fallbackAppName: string
  fallbackFromName: string
  trustedClients: readonly string[]
}): Promise<(RenderedEmail & { fromName: string }) | null> {
  const {
    clientId,
    code,
    isNewUser,
    toEmail,
    fallbackAppName,
    fallbackFromName,
    trustedClients,
  } = opts

  if (!trustedClients.includes(clientId)) return null

  let metadata
  try {
    metadata = await resolveClientMetadata(clientId)
  } catch (err) {
    logger.warn({ err, clientId }, 'Failed to resolve client metadata')
    return null
  }
  if (!metadata.email_template_uri) return null

  const template = await fetchTemplate(metadata.email_template_uri)
  if (!template) return null

  const appName = metadata.client_name || fallbackAppName
  const html = renderTemplate(template, {
    code,
    app_name: appName,
    logo_uri: metadata.logo_uri || '',
    is_new_user: isNewUser,
    email: toEmail,
  })

  let subject: string
  if (metadata.email_subject_template) {
    subject = renderSubjectTemplate(metadata.email_subject_template, {
      code,
      app_name: appName,
    })
  } else if (isNewUser) {
    subject = `${formatOtpPlain(code)} — Welcome to ${appName}`
  } else {
    subject = `${formatOtpPlain(code)} is your sign-in code for ${appName}`
  }

  const text = `Your code for ${appName} is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, you can safely ignore this email.`

  const fromName = metadata.client_name || fallbackFromName

  return { subject, text, html, fromName }
}
