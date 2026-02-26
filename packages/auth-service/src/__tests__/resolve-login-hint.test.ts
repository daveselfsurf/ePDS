/**
 * Tests for resolveLoginHint() and the PAR login-hint fetch logic.
 *
 * resolveLoginHint() determines whether a login_hint is an email, handle,
 * or DID and resolves it to an email address via pds-core's internal API.
 *
 * The PAR login-hint fetch (in login-page.ts) retrieves a login_hint from
 * a stored PAR request when the hint isn't on the redirect URL query string.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveLoginHint } from '../lib/resolve-login-hint.js'

const PDS_URL = 'http://core:3000'
const SECRET = 'test-internal-secret'

// Spy on global fetch — restored after each test
let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  fetchSpy.mockRestore()
})

describe('resolveLoginHint', () => {
  it('returns null for empty string', async () => {
    expect(await resolveLoginHint('', PDS_URL, SECRET)).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns email directly when hint contains @', async () => {
    const email = 'user@example.com'
    expect(await resolveLoginHint(email, PDS_URL, SECRET)).toBe(email)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns email for mixed-case email hint', async () => {
    const email = 'User@Example.COM'
    expect(await resolveLoginHint(email, PDS_URL, SECRET)).toBe(email)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('resolves handle to email via internal API', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ email: 'alice@example.com' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await resolveLoginHint('alice.pds.example', PDS_URL, SECRET)
    expect(result).toBe('alice@example.com')

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, opts] = fetchSpy.mock.calls[0]
    expect(url).toBe(
      `${PDS_URL}/_internal/account-by-handle?handle=alice.pds.example`,
    )
    expect((opts as RequestInit).headers).toEqual({
      'x-internal-secret': SECRET,
    })
  })

  it('resolves DID to email via internal API', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ email: 'bob@example.com' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await resolveLoginHint('did:plc:abc123', PDS_URL, SECRET)
    expect(result).toBe('bob@example.com')

    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe(
      `${PDS_URL}/_internal/account-by-handle?handle=did%3Aplc%3Aabc123`,
    )
  })

  it('returns null when internal API returns 404', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
    )

    const result = await resolveLoginHint(
      'unknown.pds.example',
      PDS_URL,
      SECRET,
    )
    expect(result).toBeNull()
  })

  it('returns null when internal API returns 401', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    )

    const result = await resolveLoginHint('alice.pds.example', PDS_URL, SECRET)
    expect(result).toBeNull()
  })

  it('returns null when internal API returns email: null', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ email: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await resolveLoginHint('alice.pds.example', PDS_URL, SECRET)
    expect(result).toBeNull()
  })

  it('returns null when fetch throws (network error)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Connection refused'))

    const result = await resolveLoginHint('alice.pds.example', PDS_URL, SECRET)
    expect(result).toBeNull()
  })

  it('returns null when fetch times out', async () => {
    fetchSpy.mockRejectedValueOnce(new DOMException('Timeout', 'TimeoutError'))

    const result = await resolveLoginHint('alice.pds.example', PDS_URL, SECRET)
    expect(result).toBeNull()
  })

  it('URL-encodes special characters in handle', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ email: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await resolveLoginHint('handle with spaces', PDS_URL, SECRET)

    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe(
      `${PDS_URL}/_internal/account-by-handle?handle=handle%20with%20spaces`,
    )
  })
})

describe('PAR login-hint fetch logic', () => {
  // These tests exercise the same pattern used in login-page.ts lines 133-155:
  // fetch /_internal/par-login-hint, extract login_hint from response.

  async function fetchParLoginHint(
    pdsInternalUrl: string,
    requestUri: string,
    internalSecret: string,
  ): Promise<string | null> {
    try {
      const parRes = await fetch(
        `${pdsInternalUrl}/_internal/par-login-hint?request_uri=${encodeURIComponent(requestUri)}`,
        {
          headers: { 'x-internal-secret': internalSecret },
          signal: AbortSignal.timeout(3000),
        },
      )
      if (parRes.ok) {
        const data = (await parRes.json()) as { login_hint: string | null }
        return data.login_hint ?? null
      }
      return null
    } catch {
      return null
    }
  }

  it('returns login_hint from PAR when present', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ login_hint: 'alice.pds.example' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await fetchParLoginHint(
      PDS_URL,
      'urn:ietf:params:oauth:request_uri:req-abc123',
      SECRET,
    )
    expect(result).toBe('alice.pds.example')

    const [url, opts] = fetchSpy.mock.calls[0]
    expect(url).toBe(
      `${PDS_URL}/_internal/par-login-hint?request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3Areq-abc123`,
    )
    expect((opts as RequestInit).headers).toEqual({
      'x-internal-secret': SECRET,
    })
  })

  it('returns null when PAR has no login_hint', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ login_hint: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await fetchParLoginHint(
      PDS_URL,
      'urn:ietf:params:oauth:request_uri:req-nohint',
      SECRET,
    )
    expect(result).toBeNull()
  })

  it('returns null when request_uri is expired/not found', async () => {
    // pds-core returns { login_hint: null } for missing/expired PAR requests
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ login_hint: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await fetchParLoginHint(
      PDS_URL,
      'urn:ietf:params:oauth:request_uri:req-expired',
      SECRET,
    )
    expect(result).toBeNull()
  })

  it('returns null when internal API returns 401', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    )

    const result = await fetchParLoginHint(
      PDS_URL,
      'urn:ietf:params:oauth:request_uri:req-abc123',
      SECRET,
    )
    expect(result).toBeNull()
  })

  it('returns null when fetch fails (network error)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Connection refused'))

    const result = await fetchParLoginHint(
      PDS_URL,
      'urn:ietf:params:oauth:request_uri:req-abc123',
      SECRET,
    )
    expect(result).toBeNull()
  })

  it('returns null when fetch times out (hairpin NAT / missing PDS_INTERNAL_URL)', async () => {
    fetchSpy.mockRejectedValueOnce(
      new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError',
      ),
    )

    const result = await fetchParLoginHint(
      PDS_URL,
      'urn:ietf:params:oauth:request_uri:req-abc123',
      SECRET,
    )
    expect(result).toBeNull()
  })
})
