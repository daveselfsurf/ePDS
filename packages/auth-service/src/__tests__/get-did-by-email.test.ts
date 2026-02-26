/**
 * Tests for getDidByEmail().
 *
 * This function calls pds-core's /_internal/account-by-email endpoint
 * to look up whether a PDS account exists for a given email address.
 * Used to distinguish first-time sign-ups from returning logins (OTP
 * email template), consent checks, and account settings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getDidByEmail } from '../lib/get-did-by-email.js'

const PDS_URL = 'http://core:3000'
const SECRET = 'test-internal-secret'

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  fetchSpy.mockRestore()
})

describe('getDidByEmail', () => {
  it('returns DID when PDS account exists', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ did: 'did:plc:abc123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await getDidByEmail('alice@example.com', PDS_URL, SECRET)

    expect(result).toBe('did:plc:abc123')
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(fetchSpy).toHaveBeenCalledWith(
      `${PDS_URL}/_internal/account-by-email?email=alice%40example.com`,
      expect.objectContaining({
        headers: { 'x-internal-secret': SECRET },
      }),
    )
  })

  it('returns null when PDS account does not exist (did is null)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ did: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await getDidByEmail('newuser@example.com', PDS_URL, SECRET)

    expect(result).toBeNull()
  })

  it('returns null on non-OK HTTP response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    )

    const result = await getDidByEmail('alice@example.com', PDS_URL, SECRET)

    expect(result).toBeNull()
  })

  it('returns null on 404 response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }))

    const result = await getDidByEmail('alice@example.com', PDS_URL, SECRET)

    expect(result).toBeNull()
  })

  it('returns null on 500 server error', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    )

    const result = await getDidByEmail('alice@example.com', PDS_URL, SECRET)

    expect(result).toBeNull()
  })

  it('returns null on network error (fetch throws)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const result = await getDidByEmail('alice@example.com', PDS_URL, SECRET)

    expect(result).toBeNull()
  })

  it('returns null on timeout', async () => {
    fetchSpy.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'))

    const result = await getDidByEmail('alice@example.com', PDS_URL, SECRET)

    expect(result).toBeNull()
  })

  it('encodes email with special characters in URL', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ did: 'did:plc:special' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await getDidByEmail('user+tag@example.com', PDS_URL, SECRET)

    expect(fetchSpy).toHaveBeenCalledWith(
      `${PDS_URL}/_internal/account-by-email?email=user%2Btag%40example.com`,
      expect.anything(),
    )
  })

  it('passes the internal secret header', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ did: null }), { status: 200 }),
    )

    await getDidByEmail('alice@example.com', PDS_URL, 'my-secret-token')

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { 'x-internal-secret': 'my-secret-token' },
      }),
    )
  })

  it('works with different PDS URLs', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ did: 'did:plc:xyz' }), { status: 200 }),
    )

    const result = await getDidByEmail(
      'alice@example.com',
      'https://pds.example.com',
      SECRET,
    )

    expect(result).toBe('did:plc:xyz')
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://pds.example.com/_internal/account-by-email?email=alice%40example.com',
      expect.anything(),
    )
  })

  it('includes AbortSignal with timeout in request', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ did: null }), { status: 200 }),
    )

    await getDidByEmail('alice@example.com', PDS_URL, SECRET)

    const callArgs = fetchSpy.mock.calls[0]
    const options = callArgs[1] as RequestInit
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })
})
