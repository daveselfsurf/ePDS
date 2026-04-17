/**
 * Sanity checks for a client_metadata.json URL, surfaced on the
 * /preview index pages. The goal is "show the dev which fields are
 * missing, *before* they bother walking through a real OAuth flow".
 * This is not a full spec compliance check — it's a pragmatic
 * did-you-remember-X list focused on the fields ePDS actually reads.
 */

import type { ClientMetadata } from './client-metadata.js'
import { escapeHtml } from './html.js'
import { makeSafeFetch } from './safe-fetch.js'

const safeFetch = makeSafeFetch({ timeoutMs: 5_000 })

export type CheckSeverity = 'ok' | 'warn' | 'error'

export interface PreviewCheck {
  /** Stable id so the UI can style or key entries by it */
  id: string
  /** Short human label rendered in the UI */
  label: string
  severity: CheckSeverity
  /** Longer explanation, shown as a hint / tooltip */
  detail: string
  /**
   * Optional pre-escaped HTML for `label` / `detail`. When set, the
   * preview UI renders these verbatim instead of HTML-escaping the
   * plain-text equivalents, so the server can mark URL fragments,
   * query params, and field names with `<code>` without the client
   * having to parse anything. All interpolated user data must already
   * be escaped by the time it lands here — only the surrounding
   * markup is trusted.
   */
  labelHtml?: string
  detailHtml?: string
}

/**
 * Wrap `text` (literal, not pre-escaped) in `<code>` after HTML-escaping.
 * Small helper used by the check builders below so each call site can
 * stay readable.
 */
function code(text: string): string {
  return `<code>${escapeHtml(text)}</code>`
}

/**
 * Append a check for an optional https URL field (tos_uri, policy_uri, ...).
 * Missing → warn (optional). Present + valid https → ok. Present + invalid
 * or non-https → error (the consent page would render a broken link).
 */
function pushUriCheck(
  checks: PreviewCheck[],
  opts: {
    id: string
    field: string
    value: string | undefined
    description: string
  },
): void {
  const { id, field, value, description } = opts
  const label = `${field} set`
  const labelHtml = `${code(field)} set`

  if (value === undefined || value === '') {
    checks.push({
      id,
      label,
      severity: 'warn',
      detail: `No ${field}. ${description}`,
      labelHtml,
      detailHtml: `No ${code(field)}. ${description}`,
    })
    return
  }

  let parsed: URL | null = null
  try {
    parsed = new URL(value)
  } catch {
    // fall through
  }
  if (!parsed || parsed.protocol !== 'https:') {
    checks.push({
      id,
      label,
      severity: 'error',
      detail: `${field}="${value}" is not a valid https URL.`,
      labelHtml,
      detailHtml: `${code(field)}=${code('"' + value + '"')} is not a valid https URL.`,
    })
    return
  }

  checks.push({
    id,
    label,
    severity: 'ok',
    detail: `${field}="${value}".`,
    labelHtml,
    detailHtml: `${code(field)}=${code('"' + value + '"')}.`,
  })
}

export interface PreviewValidationResult {
  /** The URL the user supplied */
  url: string
  /** Whether we were able to fetch + parse metadata at all */
  fetched: boolean
  checks: PreviewCheck[]
}

/**
 * Fetch the URL and return one `PreviewCheck` per field we care about.
 * Never throws — transport failures become `error`-severity checks.
 *
 * The `trustedClients` arg is the env-local trust list. Passing `null`
 * skips the trusted-clients check entirely (for contexts where the
 * caller doesn't know it).
 */
export async function validateClientMetadataForPreview(
  url: string,
  trustedClients: string[] | null,
): Promise<PreviewValidationResult> {
  const checks: PreviewCheck[] = []

  // 1. URL shape
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    // Pure URL shape problem — no point fetching.
    checks.push({
      id: 'url-parseable',
      label: 'URL parseable',
      severity: 'error',
      detail: 'The value supplied is not a valid URL.',
    })
    return { url, fetched: false, checks }
  }
  if (parsedUrl.protocol !== 'https:') {
    checks.push({
      id: 'url-https',
      label: 'URL uses https',
      severity: 'error',
      detail:
        'client_metadata must be hosted over HTTPS (the spec requires it).',
      detailHtml: `${code('client_metadata')} must be hosted over HTTPS (the spec requires it).`,
    })
  }

  // 2. Fetch
  let metadata: ClientMetadata
  try {
    const res = await safeFetch(url, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      checks.push({
        id: 'fetch',
        label: 'Metadata fetched',
        severity: 'error',
        detail: `Upstream responded ${res.status}.`,
      })
      return { url, fetched: false, checks }
    }
    try {
      metadata = (await res.json()) as ClientMetadata
    } catch {
      checks.push({
        id: 'fetch-json',
        label: 'Response is valid JSON',
        severity: 'error',
        detail: 'The server returned 200 but the body is not valid JSON.',
      })
      return { url, fetched: false, checks }
    }
    checks.push({
      id: 'fetch',
      label: 'Metadata fetched',
      severity: 'ok',
      detail: 'Got a 200 response and parsed the JSON body.',
    })
  } catch (err) {
    checks.push({
      id: 'fetch',
      label: 'Metadata fetched',
      severity: 'error',
      detail:
        err instanceof Error ? `Fetch failed: ${err.message}` : 'Fetch failed.',
    })
    return { url, fetched: false, checks }
  }

  // 3. Content checks on the parsed metadata
  // `client_id` in the JSON should equal the URL it was fetched from —
  // the @atproto/oauth-provider enforces this too, so flagging it
  // here saves a round-trip.
  type MaybeClientId = ClientMetadata & { client_id?: string }
  const clientIdField = (metadata as MaybeClientId).client_id
  if (clientIdField && clientIdField !== url) {
    checks.push({
      id: 'client-id-match',
      label: 'client_id matches URL',
      severity: 'error',
      detail: `JSON has client_id="${clientIdField}" but was fetched from ${url}.`,
      labelHtml: `${code('client_id')} matches URL`,
      detailHtml: `JSON has ${code('client_id')}=${code('"' + clientIdField + '"')} but was fetched from ${code(url)}.`,
    })
  } else if (clientIdField) {
    checks.push({
      id: 'client-id-match',
      label: 'client_id matches URL',
      severity: 'ok',
      detail: 'client_id field equals the fetched URL.',
      labelHtml: `${code('client_id')} matches URL`,
      detailHtml: `${code('client_id')} field equals the fetched URL.`,
    })
  } else {
    checks.push({
      id: 'client-id-match',
      label: 'client_id matches URL',
      severity: 'error',
      detail: 'No client_id field in the JSON.',
      labelHtml: `${code('client_id')} matches URL`,
      detailHtml: `No ${code('client_id')} field in the JSON.`,
    })
  }

  type MaybeRedirects = ClientMetadata & { redirect_uris?: unknown }
  const redirectUris = (metadata as MaybeRedirects).redirect_uris
  if (Array.isArray(redirectUris) && redirectUris.length > 0) {
    checks.push({
      id: 'redirect-uris',
      label: 'redirect_uris non-empty',
      severity: 'ok',
      detail: `Found ${redirectUris.length} redirect URI(s).`,
      labelHtml: `${code('redirect_uris')} non-empty`,
      detailHtml: `Found ${redirectUris.length} redirect URI(s).`,
    })
  } else {
    checks.push({
      id: 'redirect-uris',
      label: 'redirect_uris non-empty',
      severity: 'error',
      detail: 'OAuth needs at least one redirect URI.',
      labelHtml: `${code('redirect_uris')} non-empty`,
    })
  }

  // Branding fields. Not required by the spec, but ePDS uses them; if
  // they're missing the preview pages fall back to ePDS defaults —
  // which is usually not what the user meant to preview.
  if (metadata.brand_color) {
    checks.push({
      id: 'brand-color',
      label: 'brand_color set',
      severity: 'ok',
      detail: `brand_color="${metadata.brand_color}" — used as the primary accent on auth-service pages.`,
      labelHtml: `${code('brand_color')} set`,
      detailHtml: `${code('brand_color')}=${code('"' + metadata.brand_color + '"')} — used as the primary accent on auth-service pages.`,
    })
  } else {
    checks.push({
      id: 'brand-color',
      label: 'brand_color set',
      severity: 'warn',
      detail:
        'Optional. Without it, the login / OTP / choose-handle pages fall back to the ePDS default accent.',
      labelHtml: `${code('brand_color')} set`,
    })
  }

  if (metadata.background_color) {
    checks.push({
      id: 'background-color',
      label: 'background_color set',
      severity: 'ok',
      detail: `background_color="${metadata.background_color}" — page background on auth-service pages.`,
      labelHtml: `${code('background_color')} set`,
      detailHtml: `${code('background_color')}=${code('"' + metadata.background_color + '"')} — page background on auth-service pages.`,
    })
  } else {
    checks.push({
      id: 'background-color',
      label: 'background_color set',
      severity: 'warn',
      detail:
        'Optional. Without it, auth-service pages use the ePDS default page background.',
      labelHtml: `${code('background_color')} set`,
    })
  }

  const cssString = metadata.branding?.css
  if (typeof cssString === 'string' && cssString.trim().length > 0) {
    const bytes = new TextEncoder().encode(cssString).byteLength
    checks.push({
      id: 'branding-css',
      label: 'branding.css present',
      severity: 'ok',
      detail: `${bytes.toLocaleString()} bytes. Injected into /preview/consent (pds-core) and the auth-service pages when the client is trusted.`,
      labelHtml: `${code('branding.css')} present`,
      detailHtml: `${bytes.toLocaleString()} bytes. Injected into ${code('/preview/consent')} (pds-core) and the auth-service pages when the client is trusted.`,
    })
  } else if (cssString !== undefined) {
    checks.push({
      id: 'branding-css',
      label: 'branding.css present',
      severity: 'warn',
      detail: 'branding.css is present but empty.',
      labelHtml: `${code('branding.css')} present`,
      detailHtml: `${code('branding.css')} is present but empty.`,
    })
  } else {
    checks.push({
      id: 'branding-css',
      label: 'branding.css present',
      severity: 'warn',
      detail:
        'No branding.css — preview will render the page unbranded (beyond brand_color / background_color, if set).',
      labelHtml: `${code('branding.css')} present`,
      detailHtml: `No ${code('branding.css')} — preview will render the page unbranded (beyond ${code('brand_color')} / ${code('background_color')}, if set).`,
    })
  }

  // Legal / discoverability URIs — surfaced as links on the consent screen.
  // Optional in the spec, but their absence is almost always an oversight:
  // without them the consent page has no way to link to the client's
  // terms of service or privacy policy.
  pushUriCheck(checks, {
    id: 'tos-uri',
    field: 'tos_uri',
    value: metadata.tos_uri,
    description:
      "Terms-of-service URL. Rendered as a link on the consent page so users can review the client's terms before granting access.",
  })
  pushUriCheck(checks, {
    id: 'policy-uri',
    field: 'policy_uri',
    value: metadata.policy_uri,
    description:
      "Privacy-policy URL. Rendered as a link on the consent page so users can review the client's privacy policy before granting access.",
  })

  // 4. Trusted-clients membership (optional; caller may skip)
  if (trustedClients !== null) {
    const trusted = trustedClients.includes(url)
    checks.push({
      id: 'trusted-client',
      label: 'Listed in PDS_OAUTH_TRUSTED_CLIENTS',
      severity: trusted ? 'ok' : 'warn',
      detail: trusted
        ? 'This client is in the trust list, so branding.css is injected on real and preview flows.'
        : "This client is NOT in the trust list on this service — branding.css won't be injected on any flow (real or preview) until it's added. Ask the PDS operator to append your URL to PDS_OAUTH_TRUSTED_CLIENTS.",
      labelHtml: `Listed in ${code('PDS_OAUTH_TRUSTED_CLIENTS')}`,
      detailHtml: trusted
        ? `This client is in the trust list, so ${code('branding.css')} is injected on real and preview flows.`
        : `This client is NOT in the trust list on this service — ${code('branding.css')} won't be injected on any flow (real or preview) until it's added. Ask the PDS operator to append your URL to ${code('PDS_OAUTH_TRUSTED_CLIENTS')}.`,
    })
  }

  return { url, fetched: true, checks }
}
