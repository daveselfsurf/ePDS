/**
 * Preview route for the pds-core OAuth account chooser.
 *
 * Mirrors {@link ./preview-consent.ts} but drives the SPA into chooser
 * mode (no `selected` session, no `consentRequired`) and exercises the
 * same `<head>` injection that the real `chooserEnrichmentMiddleware`
 * applies — `<meta name="epds-handle-mode">`, `<meta
 * name="epds-auth-origin">`, and the enrichment `<script>` — so what
 * branding developers see here matches what real users see.
 *
 * Gated by `PDS_PREVIEW_ROUTES=1`.
 *
 * Query parameters drive the fixture without needing N separate routes:
 *   - `?numAccounts=N`        — 0..10 fixture sessions (default 1).
 *   - `?epds_handle_mode=<x>` — same per-request handle-mode override
 *                               that real OAuth flows accept. When
 *                               absent, the mode is resolved from the
 *                               `?client_id=` metadata via the same
 *                               `resolveHandleMode` chain the real
 *                               middleware uses (query > metadata >
 *                               env default).
 *   - `?client_id=<url>`      — same client-metadata-driven CSS
 *                               injection as /preview/consent.
 *
 * Emails are always present on the fixture sessions — the chooser's
 * value-add is showing email beside (or instead of) handle, so a
 * preview without emails would have nothing to demonstrate.
 */
import {
  escapeHtml,
  resolveHandleMode,
  VALID_HANDLE_MODES,
  type ClientMetadata,
  type HandleMode,
} from '@certified-app/shared'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import serialize from 'serialize-javascript'
import {
  buildChooserEnrichmentScript,
  escapeHtmlAttr,
} from '../chooser-enrichment.js'

const nodeRequire = createRequire(__filename)

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
  const manifestPath = nodeRequire.resolve(
    '@atproto/oauth-provider-ui/bundle-manifest.json',
  )
  const manifest = JSON.parse(
    await readFile(manifestPath, 'utf8'),
  ) as BundleManifest
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
  numAccounts: number
  handleMode: HandleMode
}

const MAX_FIXTURE_ACCOUNTS = 10

// A small, recognisable cast of fixture identities so the chooser
// preview shows visibly different rows rather than alice-1/alice-2/…
const FIXTURE_ACCOUNTS: readonly { handle: string; name: string }[] = [
  { handle: 'alice.preview.example', name: 'Alice Preview' },
  { handle: 'bob.preview.example', name: 'Bob Preview' },
  { handle: 'carol.preview.example', name: 'Carol Preview' },
  { handle: 'dave.preview.example', name: 'Dave Preview' },
  { handle: 'erin.preview.example', name: 'Erin Preview' },
  { handle: 'frank.preview.example', name: 'Frank Preview' },
  { handle: 'gina.preview.example', name: 'Gina Preview' },
  { handle: 'henry.preview.example', name: 'Henry Preview' },
  { handle: 'iris.preview.example', name: 'Iris Preview' },
  { handle: 'jack.preview.example', name: 'Jack Preview' },
] as const

function buildAuthorizeData(opts: PreviewFixtureOptions): unknown {
  // Same minimal AuthorizeData fixture as /preview/consent — see
  // preview-consent.ts for field rationale. No loginHint so the SPA
  // doesn't enter forceSignIn mode.
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

function buildSessions(opts: PreviewFixtureOptions): unknown {
  // Drive the SPA's chooser view: every session has selected=false so
  // the gate that mounts <ConsentView> never fires. loginRequired=false
  // because the chooser shows fully-bound accounts; consentRequired is
  // irrelevant in the chooser view but we set it true so a user click
  // through would land on the consent step (matching real-flow shape).
  const n = Math.min(MAX_FIXTURE_ACCOUNTS, Math.max(0, opts.numAccounts))
  return FIXTURE_ACCOUNTS.slice(0, n).map((a, idx) => ({
    account: {
      sub: `did:web:preview-${idx}.example`,
      aud: 'https://preview.example',
      preferred_username: a.handle,
      name: a.name,
      email: `${a.handle.split('.')[0]}@preview.example`,
    },
    selected: false,
    loginRequired: false,
    consentRequired: true,
  }))
}

async function renderChooserHtml(opts: {
  fixture: PreviewFixtureOptions
  authOrigin: string
  injectedCss: string | null
}): Promise<string> {
  const { scripts, styles } = await loadAssetRefs()

  const hydration = renderHydration({
    __authorizeData: buildAuthorizeData(opts.fixture),
    __sessions: buildSessions(opts.fixture),
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

  // Mirror the real chooserEnrichmentMiddleware's <head> injection
  // exactly: meta epds-handle-mode + meta epds-auth-origin + the
  // enrichment script. Order matters — the script reads both metas at
  // start, so they must appear first.
  const enrichmentJs = buildChooserEnrichmentScript()
  const handleModeMeta = `<meta name="epds-handle-mode" content="${opts.fixture.handleMode}">`
  const authOriginMeta = `<meta name="epds-auth-origin" content="${escapeHtmlAttr(opts.authOrigin)}">`
  const enrichmentScript = `<script>${enrichmentJs}</script>`

  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex">
    ${handleModeMeta}
    ${authOriginMeta}
    <link rel="icon" href="/static/favicon.svg" media="(prefers-color-scheme: light)" type="image/svg+xml">
    <link rel="icon" href="/static/favicon-dark.svg" media="(prefers-color-scheme: dark)" type="image/svg+xml">
    <title>Chooser preview — ${escapeHtml(opts.fixture.clientId)}</title>
    ${styleLinks}
    ${injectedStyle}
    ${enrichmentScript}
  </head>
  <body class="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
    <div id="root"></div>
    <script>${hydration}</script>
    ${scriptTags}
  </body>
</html>`
}

interface PreviewChooserDeps {
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
  /** Auth-service origin written into the epds-auth-origin meta tag. */
  authOrigin: string
  logger: LoggerLike
}

const FIXTURE_DEFAULT_CLIENT_ID = 'https://preview.example/client-metadata.json'

function parseNumAccounts(raw: unknown): number {
  if (typeof raw !== 'string') return 1
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return 1
  return Math.min(MAX_FIXTURE_ACCOUNTS, Math.max(0, n))
}

/**
 * Express handler factory: creates a GET /preview/chooser handler if
 * the env var is on, returns null otherwise so the caller can skip
 * wiring.
 */
export function createPreviewChooserHandler(
  deps: PreviewChooserDeps,
): ((req: RequestLike, res: ResponseLike) => Promise<void>) | null {
  if (process.env.PDS_PREVIEW_ROUTES !== '1') return null

  return async function previewChooser(req: RequestLike, res: ResponseLike) {
    const rawClientId = req.query.client_id
    const clientId =
      typeof rawClientId === 'string' && rawClientId
        ? rawClientId
        : FIXTURE_DEFAULT_CLIENT_ID

    let metadata: ClientMetadata = {}
    let injectedCss: string | null = null

    if (clientId !== FIXTURE_DEFAULT_CLIENT_ID) {
      try {
        metadata = await deps.resolveClientMetadata(clientId, {
          noCache: true,
        })
        injectedCss = deps.getClientCss(clientId, metadata, deps.trustedClients)
      } catch (err) {
        deps.logger.warn(
          { err, clientId },
          'Preview chooser: failed to resolve client metadata',
        )
      }
    }

    // Resolve handle-mode the same way the real chooserEnrichment
    // middleware does: query > client metadata > env default. Same
    // override name (epds_handle_mode) so the index dropdown exercises
    // the production resolver path verbatim.
    const queryMode =
      typeof req.query.epds_handle_mode === 'string'
        ? req.query.epds_handle_mode
        : undefined
    const rawMetaMode = metadata.epds_handle_mode
    const metaMode =
      typeof rawMetaMode === 'string' &&
      (VALID_HANDLE_MODES as readonly string[]).includes(rawMetaMode)
        ? rawMetaMode
        : undefined
    const handleMode = resolveHandleMode(queryMode, metaMode)

    const numAccounts = parseNumAccounts(req.query.numAccounts)

    const html = await renderChooserHtml({
      fixture: {
        clientId,
        clientMetadata: metadata,
        isTrusted: deps.trustedClients.includes(clientId),
        numAccounts,
        handleMode,
      },
      authOrigin: deps.authOrigin,
      injectedCss,
    })

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
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
