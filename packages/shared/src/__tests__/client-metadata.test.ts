/**
 * Tests for client metadata resolution (resolveClientName, resolveClientMetadata)
 * and CSS extraction (getClientCss).
 *
 * The SSRF-hardened safeFetch (backed by @atproto-labs/fetch-node) uses a
 * custom undici dispatcher that bypasses globalThis.fetch mocks. Tests that
 * need specific metadata responses seed the cache directly via
 * _seedClientMetadataCacheForTest instead of mocking fetch.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveClientName,
  resolveClientMetadata,
  clearClientMetadataCache,
  _seedClientMetadataCacheForTest,
  getClientCss,
} from '../client-metadata.js'

beforeEach(() => {
  clearClientMetadataCache()
})

describe('resolveClientMetadata', () => {
  it('returns client_name for non-URL client_id', async () => {
    const metadata = await resolveClientMetadata('my-local-app')
    expect(metadata.client_name).toBe('my-local-app')
  })

  it('returns seeded metadata from cache', async () => {
    _seedClientMetadataCacheForTest('https://cool.app/client-metadata.json', {
      client_name: 'Cool App',
      client_uri: 'https://cool.app',
      logo_uri: 'https://cool.app/logo.png',
    })

    const metadata = await resolveClientMetadata(
      'https://cool.app/client-metadata.json',
    )
    expect(metadata.client_name).toBe('Cool App')
    expect(metadata.client_uri).toBe('https://cool.app')
    expect(metadata.logo_uri).toBe('https://cool.app/logo.png')
  })

  it('preserves ePDS extension fields', async () => {
    _seedClientMetadataCacheForTest(
      'https://extended.app/client-metadata.json',
      {
        client_name: 'Extended App',
        brand_color: '#ff0000',
        background_color: '#ffffff',
        epds_handle_mode: 'random',
        epds_skip_consent_on_signup: true,
      },
    )

    const metadata = await resolveClientMetadata(
      'https://extended.app/client-metadata.json',
    )
    expect(metadata.brand_color).toBe('#ff0000')
    expect(metadata.background_color).toBe('#ffffff')
    expect(metadata.epds_handle_mode).toBe('random')
    expect(metadata.epds_skip_consent_on_signup).toBe(true)
  })

  it('falls back to domain for http:// URLs (safeFetch rejects non-HTTPS)', async () => {
    const metadata = await resolveClientMetadata(
      'http://local.app/client-metadata.json', // NOSONAR — testing SSRF guard
    )
    expect(metadata.client_name).toBe('local.app')
  })

  it('returns cached metadata on second call', async () => {
    _seedClientMetadataCacheForTest('https://cached.app/client-metadata.json', {
      client_name: 'Cached App',
    })

    const first = await resolveClientMetadata(
      'https://cached.app/client-metadata.json',
    )
    const second = await resolveClientMetadata(
      'https://cached.app/client-metadata.json',
    )
    expect(first).toEqual(second)
    expect(first.client_name).toBe('Cached App')
  })
})

describe('resolveClientName', () => {
  it('returns client_name from metadata', async () => {
    _seedClientMetadataCacheForTest('https://named.app/client-metadata.json', {
      client_name: 'Named App',
    })

    const name = await resolveClientName(
      'https://named.app/client-metadata.json',
    )
    expect(name).toBe('Named App')
  })

  it('falls back to domain when client_name is missing', async () => {
    _seedClientMetadataCacheForTest(
      'https://no-name.app/client-metadata.json',
      {},
    )

    const name = await resolveClientName(
      'https://no-name.app/client-metadata.json',
    )
    expect(name).toBe('no-name.app')
  })

  it('returns client_id as-is for non-URL', async () => {
    const name = await resolveClientName('unnamed-client')
    expect(name).toBe('unnamed-client')
  })
})

describe('getClientCss', () => {
  const TRUSTED = ['https://trusted.app/client-metadata.json']
  const CLIENT_ID = 'https://trusted.app/client-metadata.json'

  it('returns null for untrusted clients', () => {
    const result = getClientCss(
      'https://untrusted.app/client-metadata.json',
      { branding: { css: 'body { color: red; }' } },
      TRUSTED,
    )
    expect(result).toBeNull()
  })

  it('returns null when branding.css is absent', () => {
    expect(getClientCss(CLIENT_ID, {}, TRUSTED)).toBeNull()
    expect(getClientCss(CLIENT_ID, { branding: {} }, TRUSTED)).toBeNull()
  })

  it('returns escaped CSS for trusted client within size limit', () => {
    const result = getClientCss(
      CLIENT_ID,
      { branding: { css: 'body { color: red; }' } },
      TRUSTED,
    )
    expect(result).toBe('body { color: red; }')
  })

  it('escapes </style> sequences to prevent tag closure', () => {
    const result = getClientCss(
      CLIENT_ID,
      {
        branding: { css: 'body { content: "</style><script>bad</script>"; }' },
      },
      TRUSTED,
    )
    expect(result).not.toContain('</style>')
    expect(result).toContain('\\u003c/style>')
  })

  it('returns null when CSS exceeds 8 KB', () => {
    const oversized = 'a'.repeat(8_193)
    const result = getClientCss(
      CLIENT_ID,
      { branding: { css: oversized } },
      TRUSTED,
    )
    expect(result).toBeNull()
  })

  it('returns CSS exactly at the 8 KB limit', () => {
    const atLimit = 'a'.repeat(8_192)
    const result = getClientCss(
      CLIENT_ID,
      { branding: { css: atLimit } },
      TRUSTED,
    )
    expect(result).toBe(atLimit)
  })
})
