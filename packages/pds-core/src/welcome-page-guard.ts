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
 *  our accept/reject decision stays aligned with upstream's. */
export function parseDeviceCookies(
  cookieHeader: string | undefined,
): { deviceId: string } | null {
  if (!cookieHeader) return null
  const jar: Record<string, string> = {}
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const name = part.slice(0, eq)
    const value = decodeURIComponent(part.slice(eq + 1))
    if (!Object.hasOwn(jar, name)) jar[name] = value
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
  const parsed = new URL(origUrl, 'http://placeholder')
  const target = new URL('/oauth/authorize', authBase)
  parsed.searchParams.forEach((v, k) => {
    target.searchParams.set(k, v)
  })
  target.searchParams.set('prompt', 'login')
  return target.toString()
}

/** Emit Set-Cookie headers that clear dev-id and ses-id in both their
 *  host-only and domain-scoped variants. Browsers treat these as
 *  distinct cookies, so clearing only one leaves the other behind. */
export function appendCookieClearHeaders(
  res: Response,
  cookieDomain: string | null,
): void {
  for (const name of ['dev-id', 'ses-id']) {
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
    const parsed = parseDeviceCookies(req.headers.cookie)
    if (!parsed) {
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
