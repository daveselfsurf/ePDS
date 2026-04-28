import { escapeHtml } from '@certified-app/shared'

export function renderOptionalStyleTag(css?: string | null): string {
  if (!css) return ''
  return `\n  <style>${css}</style>`
}

const DEFAULT_FAVICON_TAGS =
  '<link rel="icon" href="/static/favicon.svg" media="(prefers-color-scheme: light)" type="image/svg+xml">\n  <link rel="icon" href="/static/favicon-dark.svg" media="(prefers-color-scheme: dark)" type="image/svg+xml">'

/**
 * Render the favicon `<link>` tag(s) for the rendered page's `<head>`.
 *
 * Three modes:
 *   - Neither URL set: emit the two default ePDS variants gated by
 *     `prefers-color-scheme` so modern browsers pick light or dark to
 *     match the user's OS theme.
 *   - Only `lightUrl`: emit a single bare `<link>` (no media query).
 *     The browser uses it for both schemes.
 *   - Both `lightUrl` and `darkUrl`: emit two `<link>`s, each with the
 *     matching `prefers-color-scheme` media query.
 *
 * Both URLs must already have been validated by `getClientFaviconUrl()` /
 * `getClientFaviconUrlDark()` upstream (HTTPS only, no credentials,
 * length-capped, same-origin as `client_id`). `escapeHtml` is
 * belt-and-suspenders against attribute-context injection; omitting a
 * type hint lets the browser sniff.
 */
export function renderFaviconTag(
  lightUrl?: string | null,
  darkUrl?: string | null,
): string {
  if (!lightUrl) return DEFAULT_FAVICON_TAGS
  if (!darkUrl) {
    return `<link rel="icon" href="${escapeHtml(lightUrl)}">`
  }
  return (
    `<link rel="icon" href="${escapeHtml(lightUrl)}" media="(prefers-color-scheme: light)">\n  ` +
    `<link rel="icon" href="${escapeHtml(darkUrl)}" media="(prefers-color-scheme: dark)">`
  )
}
