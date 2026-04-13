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

/** Create a default safeFetch instance for tests that don't need custom options. */
function defaultSafeFetch() {
  return makeSafeFetch()
}

// ---------------------------------------------------------------------------
// URL validation — scheme and hostname
// ---------------------------------------------------------------------------

describe('makeSafeFetch — URL validation', () => {
  it.each([
    ['http://', 'http://example.com/data.json', /only https/i],
    ['file://', 'file:///etc/passwd', /only https/i],
    ['data: URI', 'data:text/plain,hello', /only https/i],
    ['malformed URL', 'not-a-url', /invalid url/i],
  ])('throws for %s', async (_label, url, errorPattern) => {
    const safeFetch = defaultSafeFetch()
    await expect(safeFetch(url)).rejects.toThrow(errorPattern)
  })

  it.each([
    ['bare hostname (no dot)', 'https://myserver/path'],
    ['.local TLD', 'https://myserver.local/path'],
    ['.test TLD', 'https://myserver.test/path'],
    ['.localhost TLD', 'https://myserver.localhost/path'],
    ['.example TLD', 'https://myserver.example/path'],
    ['.invalid TLD', 'https://myserver.invalid/path'],
  ])('throws for %s', async (_label, url) => {
    const safeFetch = defaultSafeFetch()
    await expect(safeFetch(url)).rejects.toThrow(/not a public domain/i)
  })
})

// ---------------------------------------------------------------------------
// IP literal blocking
// ---------------------------------------------------------------------------

describe('makeSafeFetch — IP literal blocking', () => {
  it.each([
    ['loopback IPv4 (127.0.0.1)', 'https://127.0.0.1/client-metadata.json'],
    ['private 10.x.x.x', 'https://10.0.0.1/client-metadata.json'],
    ['private 172.16.x.x', 'https://172.16.0.1/client-metadata.json'],
    ['private 192.168.x.x', 'https://192.168.1.1/client-metadata.json'],
    [
      'link-local / cloud metadata',
      'https://169.254.169.254/latest/meta-data/',
    ],
    ['IPv6 loopback ([::1])', 'https://[::1]/client-metadata.json'],
    ['IPv6 unique-local ([fc00::1])', 'https://[fc00::1]/client-metadata.json'],
    ['IPv6 link-local ([fe80::1])', 'https://[fe80::1]/client-metadata.json'],
    [
      'IPv4-mapped IPv6 ([::ffff:192.168.1.1])',
      'https://[::ffff:192.168.1.1]/client-metadata.json',
    ],
  ])('throws for %s', async (_label, url) => {
    const safeFetch = defaultSafeFetch()
    await expect(safeFetch(url)).rejects.toThrow(/non-unicast/i)
  })

  it('does NOT call globalThis.fetch when an IP is blocked', async () => {
    const mock = mockFetchOk()
    const safeFetch = defaultSafeFetch()
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
    const safeFetch = defaultSafeFetch()
    const res = await safeFetch('https://cool.app/client-metadata.json')
    expect(res.status).toBe(200)
    expect(mock).toHaveBeenCalledOnce()
  })

  it('passes through a public unicast IPv4 (1.1.1.1)', async () => {
    const mock = mockFetchOk()
    const safeFetch = defaultSafeFetch()
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
    const safeFetch = defaultSafeFetch()
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
    const safeFetch = defaultSafeFetch()
    await safeFetch('https://cool.app/data.json')
    expect(mock).toHaveBeenCalledWith(
      'https://cool.app/data.json',
      expect.objectContaining({ redirect: 'error' }),
    )
  })

  it('overrides caller-supplied redirect mode with error', async () => {
    const mock = mockFetchOk()
    const safeFetch = defaultSafeFetch()
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

    const safeFetch = defaultSafeFetch()
    const res = await safeFetch('https://cool.app/client-metadata.json')
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body).toEqual({ client_name: 'Test App' })
  })
})
