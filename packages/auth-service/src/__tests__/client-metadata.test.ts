/**
 * Tests for auth-service client metadata — resolveClientBranding and
 * SSRF-blocked URL fallback behaviour.
 *
 * Core resolveClientMetadata / resolveClientName / getClientCss logic is
 * covered by packages/shared/src/__tests__/client-metadata.test.ts. This
 * file only tests auth-service-specific additions (resolveClientBranding)
 * and verifies that the safeFetch SSRF guards produce graceful fallbacks
 * through the re-export layer.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest'
import {
  resolveClientMetadata,
  resolveClientBranding,
  clearClientMetadataCache,
} from '../lib/client-metadata.js'

// ── fetch mock helpers ─────────────────────────────────────────────────────

function installFetchMock(impl: Mock): Mock {
  globalThis.fetch = impl as unknown as typeof fetch
  return impl
}

function mockFetchOk(body: Record<string, unknown>): Mock {
  return installFetchMock(
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  )
}

// ── setup / teardown ───────────────────────────────────────────────────────

const originalFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = originalFetch
  clearClientMetadataCache()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

// ── SSRF fallback via re-export layer ──────────────────────────────────────

describe('resolveClientMetadata — SSRF-blocked URLs fall back gracefully', () => {
  it.each([
    [
      'http:// (non-HTTPS)',
      'http://local.app/client-metadata.json', // NOSONAR — intentional: testing SSRF guard
      'local.app',
    ],
    [
      'private IPv4 (10.x)',
      'https://10.0.0.1/client-metadata.json', // NOSONAR — intentional: testing SSRF guard
      '10.0.0.1', // NOSONAR — intentional: testing SSRF guard
    ],
    ['loopback IPv4', 'https://127.0.0.1/client-metadata.json', '127.0.0.1'], // NOSONAR
    [
      'link-local (metadata)',
      'https://169.254.169.254/latest/meta-data/', // NOSONAR — intentional: testing SSRF guard
      '169.254.169.254', // NOSONAR
    ],
    ['IPv6 loopback', 'https://[::1]/client-metadata.json', '[::1]'],
    [
      'IPv4-mapped IPv6',
      'https://[::ffff:192.168.1.1]/client-metadata.json',
      '[::ffff:c0a8:101]',
    ],
  ])('falls back to domain for %s', async (_label, url, expectedDomain) => {
    const mockFetch = installFetchMock(vi.fn())

    const metadata = await resolveClientMetadata(url)
    expect(metadata.client_name).toBe(expectedDomain)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ── resolveClientBranding ──────────────────────────────────────────────────

describe('resolveClientBranding', () => {
  it('returns clientMeta, clientName, and null customCss for untrusted client', async () => {
    mockFetchOk({ client_name: 'My App' })

    const result = await resolveClientBranding(
      'https://myapp.dev/client-metadata.json',
      [],
    )

    expect(result.clientMeta.client_name).toBe('My App')
    expect(result.clientName).toBe('My App')
    expect(result.customCss).toBeNull()
  })

  it('falls back to domain for clientName when client_name is missing', async () => {
    mockFetchOk({})

    const result = await resolveClientBranding(
      'https://cool.app/client-metadata.json',
      [],
    )

    expect(result.clientName).toBe('cool.app')
    expect(result.customCss).toBeNull()
  })
})
