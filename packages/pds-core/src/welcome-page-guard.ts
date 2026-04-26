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
import type { Logger } from 'pino'

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
 *  Returns both ids when both cookies are present and valid per upstream's
 *  Zod schemas; null otherwise. Matches the parsing rules in
 *  `@atproto/oauth-provider`'s DeviceManager.parseCookie exactly so our
 *  accept/reject decision stays aligned with upstream's.
 *
 *  Both ids are returned because the guard validates the sessionId
 *  against the device row server-side: the device cookie pair can be
 *  syntactically well-formed yet semantically stale (cookie-jar
 *  divergence after a logout/rotation race, restored backup, manual
 *  deletion of the server-side row, etc.). A fresh-looking cookie pair
 *  whose ses-id no longer matches the stored sessionId is exactly the
 *  case that lets a request slip past the bindings check and land on
 *  upstream's stock welcome page.
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
): { deviceId: string; sessionId: string } | null {
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
  return { deviceId: devId, sessionId: sesId }
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
  const target = new URL('/oauth/authorize', authBase)
  // Parse the original URL to lift its query string. Malformed
  // percent-encoding (e.g. `?x=%GG`) would otherwise throw and 500 the
  // request before the bounce; on parse failure drop the inherited
  // query rather than propagate the exception — the bounce still
  // succeeds with just `prompt=login`, and auth-service will render
  // its own error for a truly broken request_uri.
  try {
    const parsed = new URL(origUrl, 'https://placeholder')
    // Assign the raw serialized query so repeated params (e.g. `scope`
    // appearing twice) survive verbatim; searchParams.forEach + set()
    // would collapse repeats to the last value, contradicting the
    // "preserves the original query string verbatim" contract below.
    target.search = parsed.search
  } catch {
    // Leave target.search empty; prompt=login is appended below.
  }
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
  // Degrade safely on malformed percent-encoding — returning false lets
  // the request fall through to upstream rather than 500ing on `?x=%GG`.
  try {
    const parsed = new URL(origUrl, 'https://placeholder')
    return parsed.searchParams.has('request_uri')
  } catch {
    return false
  }
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

/** Minimal contract the guard needs from upstream's DeviceStore: read
 *  the persisted device row by id, returning the active sessionId (and
 *  whatever else upstream stores) or null when the row is absent. We
 *  avoid importing `DeviceStore` directly so the guard doesn't take a
 *  hard dependency on the full upstream interface — the only field we
 *  actually consult is `sessionId`. */
type DeviceStoreLike = {
  readDevice: (deviceId: DeviceId) => Promise<{ sessionId: string } | null>
}

/** Create the Express middleware. `cookieDomain` may be null when the
 *  auth-service and pds-core don't share a common parent domain — in
 *  that case there's no domain-scoped cookie to clear. */
export function createWelcomePageGuard(opts: {
  authHostname: string
  provider: OAuthProvider | null
  cookieDomain: string | null
  logger?: Pick<Logger, 'error'>
}) {
  const { authHostname, provider, cookieDomain, logger } = opts
  // Upstream's `OAuthProvider` exposes only `deviceManager` publicly;
  // the underlying `DeviceStore` is held in the manager's TS-private
  // `store` field, but is needed by the guard to validate that the
  // ses-id cookie still matches the device row's active session id.
  // Accessing the runtime field via a narrow structural cast keeps
  // the dependency surface small (we only look at `sessionId`) while
  // sidestepping the private declaration.
  const deviceStore: DeviceStoreLike | null = provider
    ? (provider.deviceManager as unknown as { store: DeviceStoreLike }).store
    : null
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
    const bounceOrPass = (): void => {
      if (!inOauthFlow) {
        next()
        return
      }
      res.status(303)
      appendCookieClearHeaders(res, cookieDomain)
      res.setHeader('Location', buildBounceUrl(authHostname, req.url))
      res.setHeader('Cache-Control', 'no-store')
      res.end()
    }
    const parsed = parseDeviceCookies(req.headers.cookie)
    if (!parsed) {
      bounceOrPass()
      return
    }
    // Validate the cookie's ses-id against the device row's active
    // sessionId. A syntactically-valid cookie pair whose ses-id no
    // longer matches the stored value (logout/rotation race, restored
    // backup, manual deletion of the server-side row, fixation reset,
    // etc.) would otherwise sail past the bindings check and let
    // upstream render its stock welcome page. Treat any miss the same
    // as a missing cookie: bounce to auth-service with the stale pair
    // cleared.
    if (deviceStore) {
      let activeSessionId: string | null
      try {
        const data = await deviceStore.readDevice(parsed.deviceId as DeviceId)
        activeSessionId = data?.sessionId ?? null
      } catch (err) {
        // Mirror the listDeviceAccounts fail-closed branch below so a
        // provider fault still degrades to the email form rather than
        // leaking a stock welcome render — and log it for the same
        // reason: an unobservable surge of 303s with no correlated
        // error is a worse failure than a noisy one.
        logger?.error(
          { err, deviceId: parsed.deviceId },
          'welcome-page-guard: readDevice failed; bouncing to auth-service',
        )
        bounceOrPass()
        return
      }
      if (activeSessionId !== parsed.sessionId) {
        bounceOrPass()
        return
      }
    }
    let bindingCount: number
    try {
      const bindings = await provider.accountManager.listDeviceAccounts(
        parsed.deviceId as DeviceId,
      )
      bindingCount = bindings.length
    } catch (err) {
      // Fail closed to the email form rather than leaking a stock-welcome
      // render, but log so a genuine provider fault (DB outage, schema
      // drift, upstream assertion) doesn't disappear into an indistinguishable
      // surge of 303s to auth-service with no correlated error line.
      logger?.error(
        { err, deviceId: parsed.deviceId },
        'welcome-page-guard: listDeviceAccounts failed; bouncing to auth-service',
      )
      bindingCount = 0
    }
    if (bindingCount === 0) {
      bounceOrPass()
      return
    }
    next()
  }
}
