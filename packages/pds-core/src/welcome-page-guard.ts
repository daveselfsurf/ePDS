/**
 * Pre-route middleware that short-circuits any request which would cause
 * upstream @atproto/oauth-provider to render its three-button welcome page
 * ("Authenticate / Create new account / Sign in / Cancel").
 *
 * That page is unreachable from ePDS by design — every entry point should
 * either show the enriched chooser (when the device has bound accounts)
 * or fall back to auth-service's email/OTP form. So whenever the current
 * request resolves to a device with zero bound accounts (partial cookie
 * pair, stale pair, migration-005 TTL purge, fixation race, etc.), we
 * respond with a 303 redirect to auth-service and clear the stale
 * device-session cookies.
 *
 * Upstream's DeviceManager.hasSession/getCookies has a side effect — it
 * deletes the device row on a partial cookie pair — so we re-parse the
 * cookies ourselves using the exported Zod schemas rather than calling
 * upstream. We then query account bindings via the public
 * accountManager.listDeviceAccounts API. If bindings exist, we call
 * next() and let upstream proceed; if not, we bounce.
 *
 * See docs/design/session-reuse-bugs.md for the full failure-mode taxonomy.
 */
import type { NextFunction, Request, Response } from 'express'
import type { DeviceId, OAuthProvider } from '@atproto/oauth-provider'
import {
  DEVICE_ID_BYTES_LENGTH,
  DEVICE_ID_PREFIX,
  SESSION_ID_BYTES_LENGTH,
  SESSION_ID_PREFIX,
} from '@atproto/oauth-provider'

const DEVICE_ID_RE = new RegExp(
  `^${DEVICE_ID_PREFIX}[0-9a-f]{${DEVICE_ID_BYTES_LENGTH * 2}}$`,
)
const SESSION_ID_RE = new RegExp(
  `^${SESSION_ID_PREFIX}[0-9a-f]{${SESSION_ID_BYTES_LENGTH * 2}}$`,
)

/** True when this request path is one where upstream may render the
 *  stock welcome page. We guard the two routes upstream exposes:
 *
 *   - `/oauth/authorize` — OAuth authorization flow entry
 *   - `/account*` — standalone account management UI
 */
export function isGuardedPath(path: string): boolean {
  if (path === '/oauth/authorize') return true
  return /^\/account(?:\/.*)?$/.test(path)
}

/** Parse dev-id + ses-id from the Cookie header without any side effects.
 *  Returns the parsed deviceId when both cookies are present and valid
 *  per upstream's Zod schemas; null otherwise. Matches the parsing rules
 *  in `@atproto/oauth-provider`'s DeviceManager.parseCookie exactly so
 *  our accept/reject decision stays aligned with upstream's.
 *
 *  Only decodes the two names we care about: a sibling cookie with a
 *  malformed percent-escape (e.g. analytics SDKs that set `x=%GG`) must
 *  not be able to crash the guard. dev-id/ses-id values are hex strings
 *  upstream never percent-encodes, so decoding them is nominally a
 *  no-op, but we keep the decode to stay exactly in step with upstream's
 *  DeviceManager.parseCookie — and wrap it in try/catch so a pathological
 *  value returns null rather than throwing URIError. */
export function parseDeviceCookies(
  cookieHeader: string | undefined,
): { deviceId: string } | null {
  if (!cookieHeader) return null
  const jar: Record<string, string> = {}
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const name = part.slice(0, eq)
    if (name !== 'dev-id' && name !== 'ses-id') continue
    if (Object.hasOwn(jar, name)) continue
    const raw = part.slice(eq + 1)
    try {
      jar[name] = decodeURIComponent(raw)
    } catch {
      return null
    }
  }
  const devId = jar['dev-id']
  const sesId = jar['ses-id']
  if (!devId || !sesId) return null
  if (!DEVICE_ID_RE.test(devId)) return null
  if (!SESSION_ID_RE.test(sesId)) return null
  return { deviceId: devId }
}

/** Build the auth-service URL we bounce empty-device requests to.
 *  Preserves the original query string verbatim and appends
 *  `prompt=login` so auth-service's shouldReuseSession takes the
 *  forced-login branch (bypassing any future session-reuse check that
 *  might otherwise redirect back here). */
export function buildBounceUrl(authHostname: string, origUrl: string): string {
  const authScheme =
    authHostname === 'localhost' || authHostname.endsWith('.localhost')
      ? 'http'
      : 'https'
  const authBase = `${authScheme}://${authHostname}`
  const parsed = new URL(origUrl, 'https://placeholder')
  const target = new URL('/oauth/authorize', authBase)
  // Assign the raw serialized query so repeated params (e.g. `scope`
  // appearing twice) survive verbatim; searchParams.forEach + set()
  // would collapse repeats to the last value, contradicting the
  // "preserves the original query string verbatim" contract below.
  target.search = parsed.search
  // We intentionally override any incoming prompt — the forced-login
  // branch is the whole point of the bounce.
  target.searchParams.set('prompt', 'login')
  return target.toString()
}

/** True if the request looks like part of an active OAuth flow — i.e.
 *  it carries a `request_uri` we can preserve on the bounce. Bare
 *  `/account*` navigation (bookmarks, direct URL typing) has no
 *  OAuth context; bouncing such requests to auth-service's
 *  `/oauth/authorize` would just produce a 400 "Missing request_uri".
 *  For those we fall through to upstream instead. */
function hasOauthContext(origUrl: string): boolean {
  const parsed = new URL(origUrl, 'https://placeholder')
  return parsed.searchParams.has('request_uri')
}

/** Emit Set-Cookie headers that clear dev-id and ses-id (plus their
 *  `:hash` sidecars) in both their host-only and domain-scoped variants.
 *  Browsers treat each scope as a distinct cookie, so clearing only one
 *  leaves the other behind. The `:hash` variants only materialise when
 *  upstream is configured with cookie signing keys (which ePDS doesn't
 *  do today — `@atproto/pds@0.4.211` never threads them through), but
 *  the list matches `DEVICE_COOKIE_NAMES` in `cookie-domain.ts` so a
 *  future upstream change can't leave orphan sidecars behind. */
export function appendCookieClearHeaders(
  res: Response,
  cookieDomain: string | null,
): void {
  const names = ['dev-id', 'dev-id:hash', 'ses-id', 'ses-id:hash']
  for (const name of names) {
    res.append('Set-Cookie', `${name}=; Max-Age=0; Path=/`)
    if (cookieDomain) {
      res.append(
        'Set-Cookie',
        `${name}=; Max-Age=0; Path=/; Domain=${cookieDomain}`,
      )
    }
  }
}

/** Create the Express middleware. `cookieDomain` may be null when the
 *  auth-service and pds-core don't share a common parent domain — in
 *  that case there's no domain-scoped cookie to clear. */
export function createWelcomePageGuard(opts: {
  authHostname: string
  provider: OAuthProvider | null
  cookieDomain: string | null
}) {
  const { authHostname, provider, cookieDomain } = opts
  return async function welcomePageGuard(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (req.method !== 'GET') {
      next()
      return
    }
    if (!isGuardedPath(req.path)) {
      next()
      return
    }
    if (!provider) {
      next()
      return
    }
    // Bare /account* navigation (bookmark, direct URL) has no OAuth
    // context to preserve. auth-service's /oauth/authorize rejects such
    // requests with a 400 "Missing request_uri" — worse UX than the
    // stock upstream welcome page the guard was meant to suppress. Let
    // upstream handle these; the PR's @docker-only scenarios only cover
    // flows that originate at an OAuth entry point.
    const inOauthFlow = hasOauthContext(req.url)
    const parsed = parseDeviceCookies(req.headers.cookie)
    if (!parsed) {
      if (!inOauthFlow) {
        next()
        return
      }
      res.status(303)
      appendCookieClearHeaders(res, cookieDomain)
      res.setHeader('Location', buildBounceUrl(authHostname, req.url))
      res.setHeader('Cache-Control', 'no-store')
      res.end()
      return
    }
    let bindingCount: number
    try {
      const bindings = await provider.accountManager.listDeviceAccounts(
        parsed.deviceId as DeviceId,
      )
      bindingCount = bindings.length
    } catch {
      // Fail closed to the email form rather than leaking a stock-welcome render.
      bindingCount = 0
    }
    if (bindingCount === 0) {
      if (!inOauthFlow) {
        next()
        return
      }
      res.status(303)
      appendCookieClearHeaders(res, cookieDomain)
      res.setHeader('Location', buildBounceUrl(authHostname, req.url))
      res.setHeader('Cache-Control', 'no-store')
      res.end()
      return
    }
    next()
  }
}
