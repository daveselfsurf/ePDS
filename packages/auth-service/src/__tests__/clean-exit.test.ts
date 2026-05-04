/**
 * Tests for cleanExit() — the response emitter that turns "session
 * expired" dead-ends into clean RFC 6749 §4.1.2.1 redirects (Tier 1)
 * or a styled HTML page with a Start Over button (Tier 2). Drives
 * every branch by mocking buildClientErrorRedirect (the URL builder
 * that hits the network in production) and resolveClientMetadata
 * (the Tier-2 client_uri lookup) at the module boundary.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
} from 'vitest'
import type { Response } from 'express'

const PDS_URL = 'https://pds.example'
const CLIENT_ID = 'https://demo.example/client-metadata.json'
const REDIRECT_URI = 'https://demo.example/api/oauth/callback'

const ORIGINAL_PDS_URL = process.env.PDS_INTERNAL_URL
const ORIGINAL_SECRET = process.env.EPDS_INTERNAL_SECRET

beforeAll(() => {
  // Same as the redirect-to-client-error test — sibling module imports
  // require these env vars at evaluation time.
  process.env.PDS_INTERNAL_URL = 'https://core:3000'
  process.env.EPDS_INTERNAL_SECRET = 'test-secret'
})

afterAll(() => {
  if (ORIGINAL_PDS_URL === undefined) delete process.env.PDS_INTERNAL_URL
  else process.env.PDS_INTERNAL_URL = ORIGINAL_PDS_URL
  if (ORIGINAL_SECRET === undefined) delete process.env.EPDS_INTERNAL_SECRET
  else process.env.EPDS_INTERNAL_SECRET = ORIGINAL_SECRET
})

const buildRedirectMock = vi.hoisted(() => vi.fn())
const resolveClientMetadataMock = vi.hoisted(() => vi.fn())

vi.mock('../lib/redirect-to-client-error.js', () => ({
  buildClientErrorRedirect: buildRedirectMock,
}))
vi.mock('@certified-app/shared', async (importActual) => {
  const actual = await importActual<Record<string, unknown>>()
  return {
    ...actual,
    resolveClientMetadata: resolveClientMetadataMock,
  }
})

import { cleanExit } from '../lib/clean-exit.js'

beforeEach(() => {
  buildRedirectMock.mockReset()
  resolveClientMetadataMock.mockReset()
})

/** Build a minimal Response double that records the calls cleanExit
 *  makes on it. Same shape as the epds-callback-error test stub. */
function makeResStub() {
  const headers: Record<string, string> = {}
  let statusCode: number | undefined
  let contentType: string | undefined
  let body: string | undefined
  let redirectStatus: number | undefined
  let redirectLocation: string | undefined

  const res = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value
      return res
    },
    status(code: number) {
      statusCode = code
      return res
    },
    type(t: string) {
      contentType = t
      return res
    },
    send(s: string) {
      body = s
      return res
    },
    redirect(status: number, location: string) {
      redirectStatus = status
      redirectLocation = location
    },
  } as unknown as Response

  return {
    res,
    inspect: () => ({
      headers,
      statusCode,
      contentType,
      body,
      redirectStatus,
      redirectLocation,
    }),
  }
}

describe('cleanExit — Tier 1 (redirect to OAuth client)', () => {
  it('issues a 303 redirect to the URL built by buildClientErrorRedirect when clientId is present', async () => {
    const target = `${REDIRECT_URI}?error=access_denied&error_description=expired&iss=${encodeURIComponent(PDS_URL)}`
    buildRedirectMock.mockResolvedValueOnce(target)
    const { res, inspect } = makeResStub()

    await cleanExit({
      res,
      clientId: CLIENT_ID,
      pdsUrl: PDS_URL,
      code: 'access_denied',
      description: 'Sign-in took too long.',
    })

    const got = inspect()
    expect(got.redirectStatus).toBe(303)
    expect(got.redirectLocation).toBe(target)
    // The URL builder should have received our exact opts.
    expect(buildRedirectMock).toHaveBeenCalledWith({
      clientId: CLIENT_ID,
      pdsUrl: PDS_URL,
      code: 'access_denied',
      description: 'Sign-in took too long.',
      state: undefined,
    })
    // No metadata lookup needed — the redirect path doesn't touch
    // resolveClientHome.
    expect(resolveClientMetadataMock).not.toHaveBeenCalled()
    // No HTML body emitted.
    expect(got.body).toBeUndefined()
  })

  it('forwards state to buildClientErrorRedirect', async () => {
    buildRedirectMock.mockResolvedValueOnce('https://demo.example/cb?error=...')
    const { res } = makeResStub()
    await cleanExit({
      res,
      clientId: CLIENT_ID,
      pdsUrl: PDS_URL,
      code: 'server_error',
      description: 'd',
      state: 'XNMi',
    })
    expect(buildRedirectMock).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'XNMi' }),
    )
  })

  it('sets Cache-Control: no-store on the redirect path', async () => {
    buildRedirectMock.mockResolvedValueOnce('https://demo.example/cb?error=...')
    const { res, inspect } = makeResStub()
    await cleanExit({
      res,
      clientId: CLIENT_ID,
      pdsUrl: PDS_URL,
      code: 'access_denied',
      description: 'd',
    })
    expect(inspect().headers['cache-control']).toBe('no-store')
  })
})

describe('cleanExit — Tier 2 (Start Over fallback when redirect fails)', () => {
  it('renders the styled HTML page with a Start Over button targeting client_uri when buildClientErrorRedirect returns null', async () => {
    buildRedirectMock.mockResolvedValueOnce(null)
    resolveClientMetadataMock.mockResolvedValueOnce({
      client_uri: 'https://demo.example/',
    })
    const { res, inspect } = makeResStub()

    await cleanExit({
      res,
      clientId: CLIENT_ID,
      pdsUrl: PDS_URL,
      code: 'access_denied',
      description: 'Sign-in took too long.',
    })

    const got = inspect()
    expect(got.redirectLocation).toBeUndefined()
    expect(got.statusCode).toBe(400)
    expect(got.contentType).toBe('html')
    expect(got.body).toContain('Sign-in took too long.')
    expect(got.body).toContain('class="start-over"')
    expect(got.body).toContain('href="https://demo.example/"')
    expect(got.body).toContain('>Return to sign in</a>')
  })

  it('falls back to the clientId origin when client_uri is absent', async () => {
    buildRedirectMock.mockResolvedValueOnce(null)
    resolveClientMetadataMock.mockResolvedValueOnce({})
    const { res, inspect } = makeResStub()

    await cleanExit({
      res,
      clientId: CLIENT_ID,
      pdsUrl: PDS_URL,
      code: 'access_denied',
      description: 'd',
    })

    const got = inspect()
    expect(got.body).toContain('class="start-over"')
    // Origin of the clientId metadata URL. Note: URL.toString() on a
    // bare-origin URL adds a trailing slash, so the rendered href is
    // "https://demo.example/" rather than "https://demo.example".
    expect(got.body).toContain('href="https://demo.example/"')
  })

  it('rejects a client_uri with non-http(s) scheme and falls back to clientId origin', async () => {
    buildRedirectMock.mockResolvedValueOnce(null)
    resolveClientMetadataMock.mockResolvedValueOnce({
      client_uri: 'javascript:alert(1)',
    })
    const { res, inspect } = makeResStub()

    await cleanExit({
      res,
      clientId: CLIENT_ID,
      pdsUrl: PDS_URL,
      code: 'access_denied',
      description: 'd',
    })

    const got = inspect()
    expect(got.body).not.toContain('javascript:')
    // Falls back to clientId-origin (with URL-canonical trailing slash).
    expect(got.body).toContain('href="https://demo.example/"')
  })

  it('omits the Start Over button when client metadata lookup throws', async () => {
    buildRedirectMock.mockResolvedValueOnce(null)
    resolveClientMetadataMock.mockRejectedValueOnce(new Error('network'))
    const { res, inspect } = makeResStub()

    await cleanExit({
      res,
      clientId: CLIENT_ID,
      pdsUrl: PDS_URL,
      code: 'access_denied',
      description: 'd',
    })

    const got = inspect()
    expect(got.body).not.toContain('class="start-over"')
    expect(got.body).toContain('d')
  })

  it('honours fallbackStatus override (e.g. 500 for server_error)', async () => {
    buildRedirectMock.mockResolvedValueOnce(null)
    resolveClientMetadataMock.mockResolvedValueOnce({})
    const { res, inspect } = makeResStub()

    await cleanExit({
      res,
      clientId: CLIENT_ID,
      pdsUrl: PDS_URL,
      code: 'server_error',
      description: 'Internal failure',
      fallbackStatus: 500,
    })
    expect(inspect().statusCode).toBe(500)
  })

  it('sets Cache-Control: no-store on the HTML fallback too', async () => {
    buildRedirectMock.mockResolvedValueOnce(null)
    resolveClientMetadataMock.mockResolvedValueOnce({})
    const { res, inspect } = makeResStub()
    await cleanExit({
      res,
      clientId: CLIENT_ID,
      pdsUrl: PDS_URL,
      code: 'access_denied',
      description: 'd',
    })
    expect(inspect().headers['cache-control']).toBe('no-store')
  })
})

describe('cleanExit — no clientId in scope', () => {
  it('skips Tier 1 entirely and renders a button-less HTML page', async () => {
    const { res, inspect } = makeResStub()

    await cleanExit({
      res,
      clientId: null,
      pdsUrl: PDS_URL,
      code: 'access_denied',
      description: 'Your sign-in took too long.',
    })

    const got = inspect()
    // No metadata fetch, no redirect builder call, no Start Over
    // button — there's nothing to link to.
    expect(buildRedirectMock).not.toHaveBeenCalled()
    expect(resolveClientMetadataMock).not.toHaveBeenCalled()
    expect(got.redirectLocation).toBeUndefined()
    expect(got.statusCode).toBe(400)
    expect(got.contentType).toBe('html')
    expect(got.body).toContain('Your sign-in took too long.')
    expect(got.body).not.toContain('class="start-over"')
  })

  it('treats undefined clientId the same as null', async () => {
    const { res, inspect } = makeResStub()

    await cleanExit({
      res,
      clientId: undefined,
      pdsUrl: PDS_URL,
      code: 'access_denied',
      description: 'd',
    })

    expect(buildRedirectMock).not.toHaveBeenCalled()
    expect(inspect().contentType).toBe('html')
  })

  it('still sets Cache-Control: no-store when no clientId is in scope', async () => {
    const { res, inspect } = makeResStub()
    await cleanExit({
      res,
      clientId: null,
      pdsUrl: PDS_URL,
      code: 'access_denied',
      description: 'd',
    })
    expect(inspect().headers['cache-control']).toBe('no-store')
  })
})
