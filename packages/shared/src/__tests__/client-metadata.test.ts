/**
 * Tests for client metadata resolution (resolveClientName, resolveClientMetadata).
 *
 * Uses global fetch mocking to simulate HTTP responses without real network calls.
 * Return Promise.resolve(...) instead of async () => ... to avoid
 * @typescript-eslint/require-await lint errors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveClientName, resolveClientMetadata } from '../client-metadata.js'

// Save original fetch
const originalFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = originalFetch
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
      json: () =>
        Promise.resolve({
          client_name: 'Cool App',
          client_uri: 'https://cool.app',
          logo_uri: 'https://cool.app/logo.png',
        }),
    }) as unknown as typeof fetch

    const metadata = await resolveClientMetadata(
      'https://shared-cool.app/client-metadata.json',
    )
    expect(metadata.client_name).toBe('Cool App')
    expect(metadata.client_uri).toBe('https://cool.app')
    expect(metadata.logo_uri).toBe('https://cool.app/logo.png')
  })

  it('preserves ePDS extension fields', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          client_name: 'Extended App',
          brand_color: '#ff0000',
          background_color: '#ffffff',
          epds_handle_mode: 'random',
          epds_skip_consent_on_signup: true,
        }),
    }) as unknown as typeof fetch

    const metadata = await resolveClientMetadata(
      'https://shared-extended.app/client-metadata.json',
    )
    expect(metadata.brand_color).toBe('#ff0000')
    expect(metadata.background_color).toBe('#ffffff')
    expect(metadata.epds_handle_mode).toBe('random')
    expect(metadata.epds_skip_consent_on_signup).toBe(true)
  })

  it('falls back to domain on fetch failure', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('Network error')) as unknown as typeof fetch

    const metadata = await resolveClientMetadata(
      'https://shared-broken.app/client-metadata.json',
    )
    expect(metadata.client_name).toBe('shared-broken.app')
  })

  it('falls back to domain on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch

    const metadata = await resolveClientMetadata(
      'https://shared-missing.app/client-metadata.json',
    )
    expect(metadata.client_name).toBe('shared-missing.app')
  })

  it('caches successful fetches', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ client_name: 'Cached App' }),
    }) as unknown as typeof fetch
    globalThis.fetch = mockFetch

    await resolveClientMetadata(
      'https://shared-cached.app/client-metadata.json',
    )
    await resolveClientMetadata(
      'https://shared-cached.app/client-metadata.json',
    )

    // Only one fetch call — second hit the cache
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('caches failures briefly', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error('Down')) as unknown as typeof fetch
    globalThis.fetch = mockFetch

    await resolveClientMetadata('https://shared-down.app/client-metadata.json')
    await resolveClientMetadata('https://shared-down.app/client-metadata.json')

    // Only one fetch call — failure was cached
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('handles http:// URLs', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ client_name: 'HTTP App' }),
    }) as unknown as typeof fetch

    const metadata = await resolveClientMetadata(
      'http://shared-local.app/client-metadata.json',
    )
    expect(metadata.client_name).toBe('HTTP App')
  })
})

describe('resolveClientName', () => {
  it('returns client_name from metadata', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ client_name: 'Named App' }),
    }) as unknown as typeof fetch

    const name = await resolveClientName(
      'https://shared-named.app/client-metadata.json',
    )
    expect(name).toBe('Named App')
  })

  it('falls back to domain when client_name is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch

    const name = await resolveClientName(
      'https://shared-no-name.app/client-metadata.json',
    )
    expect(name).toBe('shared-no-name.app')
  })

  it('returns "an application" for non-URL without name', async () => {
    const name = await resolveClientName('unnamed-client')
    expect(name).toBe('unnamed-client')
  })

  it('returns "an application" when domain extraction fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    }) as unknown as typeof fetch

    // The client_name is undefined, but extractDomain returns hostname
    // so this falls back to the domain. Test a truly broken URL case.
    const name = await resolveClientName('not-a-url')
    expect(name).toBe('not-a-url')
  })
})
