/**
 * SSRF-hardened fetch utility.
 *
 * Validates URLs before fetching to prevent Server-Side Request Forgery:
 * - Requires https://
 * - Rejects IP literals that are not globally routable unicast addresses
 *   (loopback, private RFC-1918, link-local, unique-local, etc.)
 * - Rejects bare/local hostnames (.local, .test, .localhost, .invalid, .example)
 * - Disables automatic redirect following (redirect: 'error') to prevent
 *   redirects to private/internal addresses
 * - Enforces a request timeout and response Content-Length cap
 *
 * Mirrors the approach used in @atproto-labs/fetch-node (unicast.ts / safe.ts)
 * but without the DNS-level interception (undici dispatcher), which is
 * out of scope for this use case. DNS rebinding protection via pre-fetch
 * dns.resolve() is intentionally omitted — it does not close the TOCTOU race
 * window and the correct fix (undici dispatcher) requires a separate dependency.
 */

import ipaddr from 'ipaddr.js'

const { IPv4, IPv6 } = ipaddr

export type SafeFetchOptions = {
  /** Request timeout in milliseconds. Default: 5_000 */
  timeoutMs?: number
  /** Maximum allowed Content-Length in bytes. Default: 100_000 (100 KB) */
  maxBodyBytes?: number
}

/**
 * Returns:
 *   true      — hostname is a unicast IP literal (safe to fetch)
 *   false     — hostname is a non-unicast IP literal (loopback, private, etc.)
 *   undefined — hostname is a domain name (not an IP literal; allow through)
 */
function isUnicastIp(hostname: string): boolean | undefined {
  let ip: ipaddr.IPv4 | ipaddr.IPv6 | undefined

  if (IPv4.isIPv4(hostname)) {
    ip = IPv4.parse(hostname)
  } else if (hostname.startsWith('[') && hostname.endsWith(']')) {
    // URL.hostname wraps IPv6 literals in brackets — strip them before parsing
    try {
      ip = IPv6.parse(hostname.slice(1, -1))
    } catch {
      return undefined
    }
  }

  if (!ip) return undefined

  // Unwrap IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.1) before range check,
  // otherwise ipaddr classifies it as 'ipv4Mapped' instead of 'private'.
  if (ip instanceof IPv6 && ip.isIPv4MappedAddress()) {
    ip = ip.toIPv4Address()
  }

  return ip.range() === 'unicast'
}

/**
 * Heuristic check for hostnames that are typically local / internal.
 * Mirrors isLocalHostname() from @atproto-labs/fetch-node/src/unicast.ts.
 *
 * NOTE: Do not rely on this alone for security — it is a belt-and-suspenders
 * check on top of the IP literal check. DNS resolution is not performed.
 */
function isLocalHostname(hostname: string): boolean {
  const parts = hostname.split('.')
  // Bare single-label hostname (e.g. "localhost", "myserver")
  if (parts.length < 2) return true
  const tld = parts.at(-1)!.toLowerCase()
  return ['test', 'local', 'localhost', 'invalid', 'example'].includes(tld)
}

/**
 * Returns an SSRF-hardened fetch function. The returned function has the same
 * signature as the standard `fetch` API but restricted to safe, public URLs.
 *
 * @example
 * const safeFetch = makeSafeFetch({ timeoutMs: 5_000, maxBodyBytes: 100_000 })
 * const res = await safeFetch('https://example.com/data.json')
 */
export function makeSafeFetch(options: SafeFetchOptions = {}) {
  const { timeoutMs = 5_000, maxBodyBytes = 100_000 } = options

  return async function safeFetch(
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    // 1. Parse the URL — reject anything that isn't a valid URL
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error(`Invalid URL: ${url}`)
    }

    // 2. Require HTTPS
    if (parsed.protocol !== 'https:') {
      throw new Error(`Only https:// URLs are allowed, got: ${parsed.protocol}`)
    }

    // 3 & 4. Validate the hostname — IP literals and domain names differ:
    const unicast = isUnicastIp(parsed.hostname)
    if (unicast === false) {
      // It's an IP literal that is not a globally-routable unicast address
      throw new Error(`Hostname is a non-unicast address: ${parsed.hostname}`)
    } else if (unicast === undefined) {
      // It's a domain name — apply local-hostname heuristic
      if (isLocalHostname(parsed.hostname)) {
        throw new Error(`Hostname is not a public domain: ${parsed.hostname}`)
      }
    }
    // unicast === true → public IP literal, allow through

    // 5. Fetch with timeout
    // Use globalThis.fetch at call time so test mocks applied after module
    // import are correctly picked up.
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    try {
      const res = await globalThis.fetch(url, {
        ...init,
        redirect: 'error',
        // Compose internal timeout signal with any caller-supplied signal so
        // both are respected. AbortSignal.any() requires Node.js >= 20.3.0.
        signal: init?.signal
          ? AbortSignal.any([controller.signal, init.signal])
          : controller.signal,
      })

      // 6. Enforce Content-Length cap before the caller reads the body
      const cl = res.headers.get('content-length')
      if (cl !== null && parseInt(cl, 10) > maxBodyBytes) {
        await res.body?.cancel()
        throw new Error(
          `Response too large: Content-Length ${cl} exceeds ${maxBodyBytes} bytes`,
        )
      }

      return res
    } finally {
      clearTimeout(timer)
    }
  }
}
