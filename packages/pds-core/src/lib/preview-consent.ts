/**
 * Preview route for the pds-core OAuth consent page.
 *
 * Reconstructs the same HTML shell that `@atproto/oauth-provider`'s
 * authorization-page middleware emits, but with fixture hydration data
 * instead of a real OAuth request — so client-app developers can iterate
 * on their `branding.css` without walking through the full OAuth flow.
 *
 * Gated by `PDS_PREVIEW_ROUTES=1`. Disabled by default; intended for
 * preview envs and dev instances. The trusted-clients gate on CSS
 * injection is preserved (see `installCssInjectionMiddleware` — the same
 * CSS injection middleware intercepts /preview/consent responses).
 *
 * Implementation notes:
 *
 * - The provider's `sendAuthorizePageFactory` is not publicly exported, so
 *   we can't call into it directly. We rebuild the shell ourselves by
 *   mimicking `sendWebAppFactory('authorization-page', ...)` in
 *   @atproto/oauth-provider/router/assets/assets.ts.
 *
 * - The UI bundle is already served by the real provider's asset
 *   middleware at `/@atproto/oauth-provider/~assets/*`. Our preview HTML
 *   references those URLs, so the SPA loads the exact same JS/CSS the
 *   real consent page does.
 *
 * - Hydration format matches `declareHydrationData` in
 *   @atproto/oauth-provider/lib/html/hydration-data.js: each value is
 *   serialised and assigned to `window[key]`. The script then removes
 *   itself so later scripts can't read the globals. We use
 *   `serialize-javascript` rather than hand-rolling the escape so that
 *   `</script>`, `U+2028`, `U+2029`, and other JS-string-literal hazards
 *   in attacker-controllable fields (e.g. `clientId`) cannot break out
 *   of the inline script.
 *
 * - CSP: we use `script-src 'self' 'unsafe-inline'` rather than sha256-
 *   pinning the hydration script, matching the auth-service preview
 *   routes' relaxed CSP.
 */
import {
  escapeHtml,
  PREVIEW_CACHE_STATUS_HTML,
  PREVIEW_CLIENT_ID_INPUT_HTML,
  PREVIEW_CLIENT_ID_SCRIPT_HTML,
  type ClientMetadata,
} from '@certified-app/shared'
import serialize from 'serialize-javascript'

// Use structural request/response types rather than importing from
// express — pds-core doesn't depend on express's types directly and
// pulling them in would be a heavier change than the handler warrants.
type RequestLike = {
  query: Record<string, unknown>
}
type ResponseLike = {
  setHeader: (name: string, value: string) => unknown
  send: (body: string) => unknown
}

type LoggerLike = {
  info: (obj: object, msg: string) => void
  warn: (obj: object, msg: string) => void
  debug: (obj: object, msg: string) => void
}

// Deep read into the provider-ui package. Its exports map explicitly lists
// `./bundle-manifest.json`, so this is a supported entry point. If the
// package's layout changes, the preview route will fail loudly — fine for
// a dev tool. Loaded lazily (not at import-time) to avoid paying the cost
// on instances that never enable the preview.
type BundleManifest = Record<
  string,
  { type: string; mime?: string; name?: string; isEntry?: boolean }
>

let cachedAssets: { scripts: string[]; styles: string[] } | null = null

async function loadAssetRefs(): Promise<{
  scripts: string[]
  styles: string[]
}> {
  if (cachedAssets) return cachedAssets
  const mod = (await import('@atproto/oauth-provider-ui/bundle-manifest.json', {
    with: { type: 'json' },
  })) as { default: BundleManifest }
  const manifest = mod.default
  const scripts = Object.entries(manifest)
    .filter(
      ([, a]) =>
        a.type === 'chunk' && a.isEntry && a.name === 'authorization-page',
    )
    .map(([filename]) => filename)
  const styles = Object.entries(manifest)
    .filter(([, a]) => a.mime === 'text/css')
    .map(([filename]) => filename)
  cachedAssets = { scripts, styles }
  return cachedAssets
}

const ASSETS_URL_PREFIX = '/@atproto/oauth-provider/~assets/'

function assetUrl(filename: string): string {
  return `${ASSETS_URL_PREFIX}${encodeURIComponent(filename)}`
}

function renderHydration(values: Record<string, unknown>): string {
  // Mirrors @atproto/oauth-provider's declareHydrationData. We delegate the
  // actual escaping to serialize-javascript so `</script>`, U+2028/2029,
  // and other inline-script hazards in attacker-controllable values (e.g.
  // `clientId`) can't break out. `isJSON: true` tells serialize-javascript
  // the value is plain JSON-safe data (no Date/Function/RegExp round-trip
  // needed), which makes the output a drop-in for the SPA's JSON.parse.
  const lines: string[] = []
  for (const [key, val] of Object.entries(values)) {
    const keyLit = serialize(key, { isJSON: true })
    const valLit = serialize(JSON.stringify(val), { isJSON: true })
    lines.push(`window[${keyLit}]=JSON.parse(${valLit});`)
  }
  lines.push('document.currentScript.remove();')
  return lines.join('')
}

interface PreviewFixtureOptions {
  clientId: string
  clientMetadata: ClientMetadata
  isTrusted: boolean
}

function buildAuthorizeData(opts: PreviewFixtureOptions): unknown {
  // Fixture matching the AuthorizeData type in
  // @atproto/oauth-provider-ui/hydration-data.d.ts. The SPA tolerates
  // missing optional fields and empty permissionSets, so this is the
  // minimal viable shape for the consent page to render.
  //
  // Intentionally no `loginHint`: setting it flips AuthorizeView into
  // `forceSignIn` mode and shows the sign-in form instead of the consent
  // screen. The SPA's consent view is only reachable when a session is
  // already selected and `consentRequired` is true — see the fixture
  // session declared in buildSessions() below.
  return {
    requestUri:
      'urn:ietf:params:oauth:request_uri:req-preview-0000000000000000',
    clientId: opts.clientId,
    clientMetadata: opts.clientMetadata,
    clientTrusted: opts.isTrusted,
    clientFirstParty: false,
    scope: 'atproto transition:generic',
    uiLocales: undefined,
    promptMode: undefined,
    permissionSets: {},
  }
}

function buildSessions(): unknown {
  // Fixture session that drives the SPA straight to the consent screen:
  // `selected && !loginRequired && consentRequired` is the exact gate in
  // authorize-view.tsx that mounts <ConsentView>.
  return [
    {
      account: {
        sub: 'did:web:preview.example',
        aud: 'https://preview.example',
        preferred_username: 'alice.preview.example',
        name: 'Alice Preview',
        email: 'alice@preview.example',
      },
      selected: true,
      loginRequired: false,
      consentRequired: true,
    },
  ]
}

/** Build the HTML page that the real oauth-provider SPA boots from. */
async function renderConsentHtml(opts: {
  fixture: PreviewFixtureOptions
  injectedCss: string | null
}): Promise<string> {
  const { scripts, styles } = await loadAssetRefs()

  const hydration = renderHydration({
    __authorizeData: buildAuthorizeData(opts.fixture),
    __sessions: buildSessions(),
    // No customization data: pds-core's provider isn't configured with
    // `branding.colors`, so the SPA falls back to its defaults.
    __customizationData: {},
  })

  const styleLinks = styles
    .map((f) => `<link rel="stylesheet" href="${assetUrl(f)}">`)
    .join('')
  const scriptTags = scripts
    .map((f) => `<script type="module" src="${assetUrl(f)}"></script>`)
    .join('')

  const injectedStyle = opts.injectedCss
    ? `<style>${opts.injectedCss}</style>`
    : ''

  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex">
    <title>Consent preview — ${escapeHtml(opts.fixture.clientId)}</title>
    ${styleLinks}
    ${injectedStyle}
  </head>
  <body class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
    <div id="root"></div>
    <script>${hydration}</script>
    ${scriptTags}
  </body>
</html>`
}

interface PreviewConsentDeps {
  trustedClients: string[]
  resolveClientMetadata: (
    clientId: string,
    options?: { noCache?: boolean },
  ) => Promise<ClientMetadata>
  getClientCss: (
    clientId: string,
    metadata: ClientMetadata,
    trustedClients: string[],
  ) => string | null
  logger: LoggerLike
}

const FIXTURE_DEFAULT_CLIENT_ID = 'https://preview.example/client-metadata.json'

/**
 * Express handler factory: creates a GET /preview/consent handler if the
 * env var is on, returns null otherwise so the caller can skip wiring.
 */
export function createPreviewConsentHandler(
  deps: PreviewConsentDeps,
): ((req: RequestLike, res: ResponseLike) => Promise<void>) | null {
  if (process.env.PDS_PREVIEW_ROUTES !== '1') return null

  return async function previewConsent(req: RequestLike, res: ResponseLike) {
    const rawClientId = req.query.client_id
    const clientId =
      typeof rawClientId === 'string' && rawClientId
        ? rawClientId
        : FIXTURE_DEFAULT_CLIENT_ID

    let metadata: ClientMetadata = {}
    let injectedCss: string | null = null

    if (clientId !== FIXTURE_DEFAULT_CLIENT_ID) {
      try {
        // Preview routes always bypass the 10-minute client-metadata
        // cache — the whole point of /preview is to iterate on
        // branding.css and see the change on the next refresh without
        // waiting for cache expiry.
        metadata = await deps.resolveClientMetadata(clientId, {
          noCache: true,
        })
        injectedCss = deps.getClientCss(clientId, metadata, deps.trustedClients)
      } catch (err) {
        deps.logger.warn(
          { err, clientId },
          'Preview consent: failed to resolve client metadata',
        )
      }
    }

    const html = await renderConsentHtml({
      fixture: {
        clientId,
        clientMetadata: metadata,
        isTrusted: deps.trustedClients.includes(clientId),
      },
      injectedCss,
    })

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    // Relaxed CSP to match the auth-service preview routes: the hydration
    // block is an inline script, and pinning its sha256 would fight every
    // time the fixture changes. This is a dev-only surface.
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "connect-src 'self'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
      ].join('; '),
    )
    res.send(html)
  }
}

/** Static index page listing the preview route. */
export function renderPreviewIndex(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>pds-core previews</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; color: #222; }
    h1 { font-size: 22px; }
    p { line-height: 1.5; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
    ul { line-height: 2; }
    a { color: #0b5ed7; }
    label { display: block; margin: 16px 0 6px; font-weight: 500; }
    input[type="url"] { width: 100%; padding: 8px 10px; font-size: 14px; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    input[type="url"]:focus { outline: 2px solid #0b5ed7; outline-offset: -1px; border-color: transparent; }
    .cache-status { margin-top: 32px; padding: 12px 16px; background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 8px; }
    .cache-status h2 { font-size: 15px; margin: 0 0 4px; }
    .cache-status-hint { font-size: 13px; color: #555; margin: 0 0 8px; }
    .cache-entries { list-style: none; padding: 0; margin: 0; line-height: 1.8; }
    .cache-entries code { word-break: break-all; }
  </style>
</head>
<body>
  <h1>pds-core preview routes</h1>
  <p>Renders the OAuth consent page with fixture hydration data, so you can iterate on your client's <code>branding.css</code> without walking through the full OAuth flow.</p>
  <p>Pass <code>?client_id=&lt;URL-of-your-client-metadata.json&gt;</code> to inject that client's CSS. The trusted-clients check still applies: your <code>client_id</code> must be on <code>PDS_OAUTH_TRUSTED_CLIENTS</code> for its CSS to be injected. Without <code>client_id</code> the page renders unbranded (baseline).</p>
  <p>Preview routes always re-fetch client metadata — the 10-minute cache used by real flows is bypassed here, so edits to your <code>branding.css</code> show up on the next refresh.</p>
  ${PREVIEW_CLIENT_ID_INPUT_HTML}
  <ul>
    <li><a href="/preview/consent" data-preview-link>Consent page</a></li>
  </ul>
  ${PREVIEW_CACHE_STATUS_HTML}
  ${PREVIEW_CLIENT_ID_SCRIPT_HTML}
</body>
</html>`
}
