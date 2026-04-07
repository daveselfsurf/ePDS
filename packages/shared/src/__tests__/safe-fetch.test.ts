/**
 * Tests for makeSafeFetch — SSRF-hardened fetch utility.
 *
 * All network calls are intercepted via globalThis.fetch mocking so no real
 * HTTP requests are made.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeSafeFetch } from '../safe-fetch.js'

const originalFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = originalFetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchOk() {
  const mock = vi.fn().mockResolvedValue(
    new Response('ok', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }),
  )
  globalThis.fetch = mock as unknown as typeof fetch
  return mock
}

// ---------------------------------------------------------------------------
// URL validation — scheme
// ---------------------------------------------------------------------------

describe('makeSafeFetch — URL validation', () => {
  it('throws for http:// URL', async () => {
    const safeFetch = makeSafeFetch()
    await expect(safeFetch('http://example.com/data.json')).rejects.toThrow(
      /only https/i,
    )
  })

  it('throws for file:// URL', async () => {
    const safeFetch = makeSafeFetch()
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow(/only https/i)
  })

  it('throws for data: URI', async () => {
    const safeFetch = makeSafeFetch()
    await expect(safeFetch('data:text/plain,hello')).rejects.toThrow(
      /only https/i,
    )
  })

  it('throws for a malformed URL string', async () => {
    const safeFetch = makeSafeFetch()
    await expect(safeFetch('not-a-url')).rejects.toThrow(/invalid url/i)
  })

  // -------------------------------------------------------------------------
  // Local / internal hostnames
  // -------------------------------------------------------------------------

  it('throws for bare hostname (no dot)', async () => {
    const safeFetch = makeSafeFetch()
    await expect(safeFetch('https://myserver/path')).rejects.toThrow(
      /not a public domain/i,
    )
  })

  it('throws for .local TLD', async () => {
    const safeFetch = makeSafeFetch()
    await expect(safeFetch('https://myserver.local/path')).rejects.toThrow(
      /not a public domain/i,
    )
  })

  it('throws for .test TLD', async () => {
    const safeFetch = makeSafeFetch()
    await expect(safeFetch('https://myserver.test/path')).rejects.toThrow(
      /not a public domain/i,
    )
  })

  it('throws for .localhost TLD', async () => {
    const safeFetch = makeSafeFetch()
    await expect(safeFetch('https://myserver.localhost/path')).rejects.toThrow(
      /not a public domain/i,
    )
  })

  it('throws for .example TLD', async () => {
    const safeFetch = makeSafeFetch()
    await expect(safeFetch('https://myserver.example/path')).rejects.toThrow(
      /not a public domain/i,
    )
  })

  it('throws for .invalid TLD', async () => {
    const safeFetch = makeSafeFetch()
    await expect(safeFetch('https://myserver.invalid/path')).rejects.toThrow(
      /not a public domain/i,
    )
  })
})

// ---------------------------------------------------------------------------
// IP literal blocking
// ---------------------------------------------------------------------------

describe('makeSafeFetch — IP literal blocking', () => {
  it('throws for loopback IPv4 (127.0.0.1)', async () => {
    const safeFetch = makeSafeFetch()
    await expect(
      safeFetch('https://127.0.0.1/client-metadata.json'),
    ).rejects.toThrow(/non-unicast/i)
  })

  it('throws for private RFC-1918 10.x.x.x', async () => {
    const safeFetch = makeSafeFetch()
    await expect(
      safeFetch('https://10.0.0.1/client-metadata.json'),
    ).rejects.toThrow(/non-unicast/i)
  })

  it('throws for private RFC-1918 172.16.x.x', async () => {
    const safeFetch = makeSafeFetch()
    await expect(
      safeFetch('https://172.16.0.1/client-metadata.json'),
    ).rejects.toThrow(/non-unicast/i)
  })

  it('throws for private RFC-1918 192.168.x.x', async () => {
    const safeFetch = makeSafeFetch()
    await expect(
      safeFetch('https://192.168.1.1/client-metadata.json'),
    ).rejects.toThrow(/non-unicast/i)
  })

  it('throws for link-local / cloud metadata (169.254.169.254)', async () => {
    const safeFetch = makeSafeFetch()
    await expect(
      safeFetch('https://169.254.169.254/latest/meta-data/'),
    ).rejects.toThrow(/non-unicast/i)
  })

  it('throws for IPv6 loopback ([::1])', async () => {
    const safeFetch = makeSafeFetch()
    await expect(
      safeFetch('https://[::1]/client-metadata.json'),
    ).rejects.toThrow(/non-unicast/i)
  })

  it('throws for IPv6 unique-local ([fc00::1])', async () => {
    const safeFetch = makeSafeFetch()
    await expect(
      safeFetch('https://[fc00::1]/client-metadata.json'),
    ).rejects.toThrow(/non-unicast/i)
  })

  it('throws for IPv6 link-local ([fe80::1])', async () => {
    const safeFetch = makeSafeFetch()
    await expect(
      safeFetch('https://[fe80::1]/client-metadata.json'),
    ).rejects.toThrow(/non-unicast/i)
  })

  it('throws for IPv4-mapped IPv6 ([::ffff:192.168.1.1])', async () => {
    // This is the tricky bypass: ::ffff:192.168.1.1 is a private address
    // wrapped in IPv6 notation. Must be unwrapped before range check.
    const safeFetch = makeSafeFetch()
    await expect(
      safeFetch('https://[::ffff:192.168.1.1]/client-metadata.json'),
    ).rejects.toThrow(/non-unicast/i)
  })

  it('does NOT call globalThis.fetch when an IP is blocked', async () => {
    const mock = mockFetchOk()
    const safeFetch = makeSafeFetch()
    await expect(
      safeFetch('https://192.168.1.1/client-metadata.json'),
    ).rejects.toThrow()
    expect(mock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Allowed URLs — should reach the underlying fetch
// ---------------------------------------------------------------------------

describe('makeSafeFetch — allowed URLs', () => {
  it('passes through a normal public https:// domain', async () => {
    const mock = mockFetchOk()
    const safeFetch = makeSafeFetch()
    const res = await safeFetch('https://cool.app/client-metadata.json')
    expect(res.status).toBe(200)
    expect(mock).toHaveBeenCalledOnce()
  })

  it('passes through a public unicast IPv4 (1.1.1.1)', async () => {
    const mock = mockFetchOk()
    const safeFetch = makeSafeFetch()
    const res = await safeFetch('https://1.1.1.1/data.json')
    expect(res.status).toBe(200)
    expect(mock).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Fetch behaviour — timeout, size cap, headers
// ---------------------------------------------------------------------------

describe('makeSafeFetch — fetch behaviour', () => {
  it('passes init headers through to underlying fetch', async () => {
    const mock = mockFetchOk()
    const safeFetch = makeSafeFetch()
    await safeFetch('https://cool.app/data.json', {
      headers: { Accept: 'application/json' },
    })
    expect(mock).toHaveBeenCalledWith(
      'https://cool.app/data.json',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
      }),
    )
  })

  it('always passes redirect: error to underlying fetch', async () => {
    const mock = mockFetchOk()
    const safeFetch = makeSafeFetch()
    await safeFetch('https://cool.app/data.json')
    expect(mock).toHaveBeenCalledWith(
      'https://cool.app/data.json',
      expect.objectContaining({ redirect: 'error' }),
    )
  })

  it('overrides caller-supplied redirect mode with error', async () => {
    const mock = mockFetchOk()
    const safeFetch = makeSafeFetch()
    await safeFetch('https://cool.app/data.json', { redirect: 'follow' })
    expect(mock).toHaveBeenCalledWith(
      'https://cool.app/data.json',
      expect.objectContaining({ redirect: 'error' }),
    )
  })

  it('respects caller-supplied abort signal before internal timeout fires', async () => {
    const upstream = new AbortController()

    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }),
    ) as unknown as typeof fetch

    const safeFetch = makeSafeFetch({ timeoutMs: 10_000 }) // long timeout — won't fire
    const fetchPromise = safeFetch('https://cool.app/data.json', {
      signal: upstream.signal,
    })

    upstream.abort() // fire upstream before the 10s timeout

    await expect(fetchPromise).rejects.toThrow(/aborted/i)
  })

  it('aborts and throws after timeoutMs', async () => {
    vi.useFakeTimers()

    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // Simulate the AbortSignal being triggered
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        }),
    ) as unknown as typeof fetch

    const safeFetch = makeSafeFetch({ timeoutMs: 100 })
    const fetchPromise = safeFetch('https://slow.app/data.json')

    vi.advanceTimersByTime(200)

    await expect(fetchPromise).rejects.toThrow(/aborted/i)
  })

  it('throws when Content-Length exceeds maxBodyBytes', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('x'.repeat(10), {
        status: 200,
        headers: { 'content-length': '999999' },
      }),
    ) as unknown as typeof fetch

    const safeFetch = makeSafeFetch({ maxBodyBytes: 1000 })
    await expect(safeFetch('https://big.app/data.json')).rejects.toThrow(
      /too large/i,
    )
  })

  it('returns the response on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ client_name: 'Test App' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const safeFetch = makeSafeFetch()
    const res = await safeFetch('https://cool.app/client-metadata.json')
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body).toEqual({ client_name: 'Test App' })
  })
})
