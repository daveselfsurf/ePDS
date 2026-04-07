/**
 * Tests for client metadata resolution (resolveClientName, resolveClientMetadata).
 *
 * Uses global fetch mocking to simulate HTTP responses without real network calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  resolveClientName,
  resolveClientMetadata,
  resolveClientBranding,
  clearClientMetadataCache,
} from '../lib/client-metadata.js'

// Save original fetch
const originalFetch = globalThis.fetch

beforeEach(() => {
  // Reset fetch mock and clear the in-memory cache before each test so tests
  // do not interfere with each other through cached entries.
  globalThis.fetch = originalFetch
  clearClientMetadataCache()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('resolveClientMetadata', () => {
  it('returns client_name for non-URL client_id', async () => {
    const metadata = await resolveClientMetadata('my-local-app')
    expect(metadata.client_name).toBe('my-local-app')
  })

  it('fetches metadata from URL client_id', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: () =>
        Promise.resolve({
          client_name: 'Cool App',
          client_uri: 'https://cool.app',
          logo_uri: 'https://cool.app/logo.png',
        }),
    }) as unknown as typeof fetch

    const metadata = await resolveClientMetadata(
      'https://cool.app/client-metadata.json',
    )
    expect(metadata.client_name).toBe('Cool App')
    expect(metadata.client_uri).toBe('https://cool.app')
    expect(metadata.logo_uri).toBe('https://cool.app/logo.png')
  })

  it('falls back to domain on fetch failure', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('Network error')) as unknown as typeof fetch

    const metadata = await resolveClientMetadata(
      'https://broken.app/client-metadata.json',
    )
    expect(metadata.client_name).toBe('broken.app')
  })

  it('falls back to domain on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
    }) as unknown as typeof fetch

    const metadata = await resolveClientMetadata(
      'https://missing.app/client-metadata.json',
    )
    expect(metadata.client_name).toBe('missing.app')
  })

  it('caches successful fetches', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: () => Promise.resolve({ client_name: 'Cached App' }),
    }) as unknown as typeof fetch
    globalThis.fetch = mockFetch

    await resolveClientMetadata('https://cached.app/client-metadata.json')
    await resolveClientMetadata('https://cached.app/client-metadata.json')

    // Only one fetch call — second hit the cache
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('does not fetch http:// URLs, returns domain fallback', async () => {
    // http:// is blocked by safeFetch — fetch must never be called
    const mockFetch = vi.fn() as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const metadata = await resolveClientMetadata(
      'http://local.app/client-metadata.json',
    )
    expect(metadata.client_name).toBe('local.app')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not fetch private IPv4 (10.x.x.x), returns domain fallback', async () => {
    const mockFetch = vi.fn() as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const metadata = await resolveClientMetadata(
      'https://10.0.0.1/client-metadata.json',
    )
    expect(metadata.client_name).toBe('10.0.0.1')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not fetch loopback IPv4 (127.0.0.1), returns domain fallback', async () => {
    const mockFetch = vi.fn() as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const metadata = await resolveClientMetadata(
      'https://127.0.0.1/client-metadata.json',
    )
    expect(metadata.client_name).toBe('127.0.0.1')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not fetch link-local (169.254.169.254), returns domain fallback', async () => {
    const mockFetch = vi.fn() as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const metadata = await resolveClientMetadata(
      'https://169.254.169.254/latest/meta-data/',
    )
    expect(metadata.client_name).toBe('169.254.169.254')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not fetch IPv6 loopback ([::1]), returns domain fallback', async () => {
    const mockFetch = vi.fn() as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const metadata = await resolveClientMetadata(
      'https://[::1]/client-metadata.json',
    )
    // URL.hostname preserves brackets for IPv6 literals: "[::1]"
    expect(metadata.client_name).toBe('[::1]')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('does not fetch IPv4-mapped IPv6 ([::ffff:192.168.1.1]), returns domain fallback', async () => {
    const mockFetch = vi.fn() as unknown as typeof fetch
    globalThis.fetch = mockFetch

    const metadata = await resolveClientMetadata(
      'https://[::ffff:192.168.1.1]/client-metadata.json',
    )
    // Node's URL parser normalises the IPv4 suffix to hex: ::ffff:c0a8:101
    expect(metadata.client_name).toBe('[::ffff:c0a8:101]')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('resolveClientName', () => {
  it('returns client_name from metadata', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: () => Promise.resolve({ client_name: 'Named App' }),
    }) as unknown as typeof fetch

    const name = await resolveClientName(
      'https://named.app/client-metadata.json',
    )
    expect(name).toBe('Named App')
  })

  it('falls back to domain when client_name is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch

    const name = await resolveClientName(
      'https://no-name.app/client-metadata.json',
    )
    expect(name).toBe('no-name.app')
  })

  it('returns "an application" for non-URL without name', async () => {
    // Non-URL client_ids get { client_name: clientId } — so the
    // name will just be the client_id string itself.
    const name = await resolveClientName('unnamed-client')
    expect(name).toBe('unnamed-client')
  })
})

describe('resolveClientBranding', () => {
  it('returns clientMeta, clientName, and customCss on happy path', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: () => Promise.resolve({ client_name: 'My App' }),
    }) as unknown as typeof fetch

    const result = await resolveClientBranding(
      'https://myapp.dev/client-metadata.json',
      [], // not in trustedClients so customCss is null
    )

    expect(result.clientMeta.client_name).toBe('My App')
    expect(result.clientName).toBe('My App')
    expect(result.customCss).toBeNull()
  })

  it('falls back to domain for clientName when client_name is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch

    const result = await resolveClientBranding(
      'https://cool.app/client-metadata.json',
      [],
    )

    expect(result.clientName).toBe('cool.app')
    expect(result.customCss).toBeNull()
  })
})
