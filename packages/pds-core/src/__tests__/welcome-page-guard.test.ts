import type { Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import {
  appendCookieClearHeaders,
  buildBounceUrl,
  createWelcomePageGuard,
  isGuardedPath,
  parseDeviceCookies,
} from '../welcome-page-guard.js'

const VALID_DEV = 'dev-0123456789abcdef0123456789abcdef'
const VALID_SES = 'ses-fedcba9876543210fedcba9876543210'

describe('isGuardedPath', () => {
  it('matches /oauth/authorize exactly', () => {
    expect(isGuardedPath('/oauth/authorize')).toBe(true)
  })

  it('matches /account and its subpaths', () => {
    expect(isGuardedPath('/account')).toBe(true)
    expect(isGuardedPath('/account/')).toBe(true)
    expect(isGuardedPath('/account/settings')).toBe(true)
    expect(isGuardedPath('/account/reset-password')).toBe(true)
  })

  it('does not match unrelated paths', () => {
    expect(isGuardedPath('/')).toBe(false)
    expect(isGuardedPath('/oauth/token')).toBe(false)
    expect(isGuardedPath('/accounts')).toBe(false)
    expect(isGuardedPath('/oauth/authorize/accept')).toBe(false)
  })
})

describe('parseDeviceCookies', () => {
  it('returns the deviceId when both cookies are valid', () => {
    expect(
      parseDeviceCookies(`dev-id=${VALID_DEV}; ses-id=${VALID_SES}`),
    ).toEqual({ deviceId: VALID_DEV })
  })

  it('returns null when the Cookie header is missing', () => {
    expect(parseDeviceCookies(undefined)).toBeNull()
    expect(parseDeviceCookies('')).toBeNull()
  })

  it('returns null when only dev-id is present', () => {
    expect(parseDeviceCookies(`dev-id=${VALID_DEV}`)).toBeNull()
  })

  it('returns null when only ses-id is present', () => {
    expect(parseDeviceCookies(`ses-id=${VALID_SES}`)).toBeNull()
  })

  it('returns null when dev-id fails the schema (bad prefix)', () => {
    expect(
      parseDeviceCookies(
        `dev-id=xxx-${VALID_DEV.slice(4)}; ses-id=${VALID_SES}`,
      ),
    ).toBeNull()
  })

  it('returns null when dev-id fails the schema (wrong length)', () => {
    expect(
      parseDeviceCookies(`dev-id=dev-short; ses-id=${VALID_SES}`),
    ).toBeNull()
  })

  it('returns null when ses-id fails the schema', () => {
    expect(parseDeviceCookies(`dev-id=${VALID_DEV}; ses-id=bogus`)).toBeNull()
  })

  it('ignores unrelated cookies', () => {
    expect(
      parseDeviceCookies(
        `csrf=abc; dev-id=${VALID_DEV}; junk=1; ses-id=${VALID_SES}`,
      ),
    ).toEqual({ deviceId: VALID_DEV })
  })

  it('uses the first occurrence of a repeated cookie name', () => {
    const other = 'dev-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    expect(
      parseDeviceCookies(
        `dev-id=${VALID_DEV}; dev-id=${other}; ses-id=${VALID_SES}`,
      ),
    ).toEqual({ deviceId: VALID_DEV })
  })
})

describe('buildBounceUrl', () => {
  it('preserves the original query string and appends prompt=login', () => {
    const url = buildBounceUrl(
      'auth.pds.example',
      '/oauth/authorize?request_uri=urn:x:1&client_id=https://c.example/m.json',
    )
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe(
      'https://auth.pds.example/oauth/authorize',
    )
    expect(parsed.searchParams.get('request_uri')).toBe('urn:x:1')
    expect(parsed.searchParams.get('client_id')).toBe(
      'https://c.example/m.json',
    )
    expect(parsed.searchParams.get('prompt')).toBe('login')
  })

  it('uses http for localhost hosts', () => {
    expect(buildBounceUrl('auth.localhost', '/oauth/authorize')).toContain(
      'http://auth.localhost/',
    )
    expect(buildBounceUrl('localhost', '/oauth/authorize')).toContain(
      'http://localhost/',
    )
  })

  it('uses https for real hostnames', () => {
    expect(buildBounceUrl('auth.pds.example', '/oauth/authorize')).toContain(
      'https://auth.pds.example/',
    )
  })

  it('overrides any existing prompt param with login', () => {
    const url = buildBounceUrl(
      'auth.pds.example',
      '/oauth/authorize?prompt=consent&request_uri=urn:x:1',
    )
    expect(new URL(url).searchParams.get('prompt')).toBe('login')
  })
})

function makeResStub(): Response & { _calls: string[][] } {
  const calls: string[][] = []
  const res = {
    _calls: calls,
    append(name: string, value: string) {
      calls.push([name, value])
      return this
    },
    status(_: number) {
      return this
    },
    setHeader() {
      return this
    },
    end() {
      return this
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stub typing
  return res as any
}

describe('appendCookieClearHeaders', () => {
  it('clears dev-id and ses-id host-only when no cookie domain given', () => {
    const res = makeResStub()
    appendCookieClearHeaders(res, null)
    expect(res._calls).toEqual([
      ['Set-Cookie', 'dev-id=; Max-Age=0; Path=/'],
      ['Set-Cookie', 'ses-id=; Max-Age=0; Path=/'],
    ])
  })

  it('also clears the domain-scoped variants when a cookie domain is given', () => {
    const res = makeResStub()
    appendCookieClearHeaders(res, 'pds.example')
    expect(res._calls).toEqual([
      ['Set-Cookie', 'dev-id=; Max-Age=0; Path=/'],
      ['Set-Cookie', 'dev-id=; Max-Age=0; Path=/; Domain=pds.example'],
      ['Set-Cookie', 'ses-id=; Max-Age=0; Path=/'],
      ['Set-Cookie', 'ses-id=; Max-Age=0; Path=/; Domain=pds.example'],
    ])
  })
})

type FakeProvider = {
  accountManager: {
    listDeviceAccounts: (id: string) => Promise<unknown[]>
  }
}

function makeReq(opts: {
  method?: string
  path?: string
  cookieHeader?: string
  url?: string
}): Request {
  return {
    method: opts.method ?? 'GET',
    path: opts.path ?? '/oauth/authorize',
    url: opts.url ?? opts.path ?? '/oauth/authorize',
    headers: { cookie: opts.cookieHeader },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function makeRes(): Response & {
  status: ReturnType<typeof vi.fn>
  setHeader: ReturnType<typeof vi.fn>
  append: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
} {
  const r = {
    status: vi.fn(function (this: unknown) {
      return r
    }),
    setHeader: vi.fn(function (this: unknown) {
      return r
    }),
    append: vi.fn(function (this: unknown) {
      return r
    }),
    end: vi.fn(function (this: unknown) {
      return r
    }),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return r as any
}

describe('createWelcomePageGuard', () => {
  const AUTH = 'auth.pds.example'

  it('passes non-GET requests through', async () => {
    const provider: FakeProvider = {
      accountManager: { listDeviceAccounts: vi.fn() },
    }
    const mw = createWelcomePageGuard({
      authHostname: AUTH,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provider: provider as any,
      cookieDomain: null,
    })
    const next = vi.fn()
    await mw(
      makeReq({ method: 'POST', path: '/oauth/authorize' }),
      makeRes(),
      next,
    )
    expect(next).toHaveBeenCalledOnce()
    expect(provider.accountManager.listDeviceAccounts).not.toHaveBeenCalled()
  })

  it('passes unguarded paths through', async () => {
    const provider: FakeProvider = {
      accountManager: { listDeviceAccounts: vi.fn() },
    }
    const mw = createWelcomePageGuard({
      authHostname: AUTH,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provider: provider as any,
      cookieDomain: null,
    })
    const next = vi.fn()
    await mw(makeReq({ path: '/health' }), makeRes(), next)
    expect(next).toHaveBeenCalledOnce()
    expect(provider.accountManager.listDeviceAccounts).not.toHaveBeenCalled()
  })

  it('passes through when provider is null (OAuth disabled)', async () => {
    const mw = createWelcomePageGuard({
      authHostname: AUTH,
      provider: null,
      cookieDomain: null,
    })
    const next = vi.fn()
    await mw(
      makeReq({ cookieHeader: `dev-id=${VALID_DEV}; ses-id=${VALID_SES}` }),
      makeRes(),
      next,
    )
    expect(next).toHaveBeenCalledOnce()
  })

  it('bounces with cookie clears when cookies are missing', async () => {
    const provider: FakeProvider = {
      accountManager: {
        listDeviceAccounts: vi.fn().mockResolvedValue([]),
      },
    }
    const mw = createWelcomePageGuard({
      authHostname: AUTH,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provider: provider as any,
      cookieDomain: 'pds.example',
    })
    const res = makeRes()
    const next = vi.fn()
    await mw(
      makeReq({ url: '/oauth/authorize?request_uri=urn:x:1' }),
      res,
      next,
    )
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(303)
    const locationCall = res.setHeader.mock.calls.find(
      ([n]) => n === 'Location',
    )
    expect(locationCall?.[1]).toContain(
      'https://auth.pds.example/oauth/authorize',
    )
    expect(locationCall?.[1]).toContain('prompt=login')
    expect(locationCall?.[1]).toContain('request_uri=urn%3Ax%3A1')
    // Four Set-Cookie entries: dev-id host + domain, ses-id host + domain
    expect(res.append).toHaveBeenCalledTimes(4)
    expect(provider.accountManager.listDeviceAccounts).not.toHaveBeenCalled()
  })

  it('bounces when cookies parse but bindings are empty', async () => {
    const provider: FakeProvider = {
      accountManager: {
        listDeviceAccounts: vi.fn().mockResolvedValue([]),
      },
    }
    const mw = createWelcomePageGuard({
      authHostname: AUTH,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provider: provider as any,
      cookieDomain: null,
    })
    const res = makeRes()
    const next = vi.fn()
    await mw(
      makeReq({
        cookieHeader: `dev-id=${VALID_DEV}; ses-id=${VALID_SES}`,
        url: '/oauth/authorize?request_uri=urn:x:1',
      }),
      res,
      next,
    )
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(303)
    expect(provider.accountManager.listDeviceAccounts).toHaveBeenCalledWith(
      VALID_DEV,
    )
  })

  it('calls next() when cookies parse and bindings exist', async () => {
    const provider: FakeProvider = {
      accountManager: {
        listDeviceAccounts: vi.fn().mockResolvedValue([{ some: 'binding' }]),
      },
    }
    const mw = createWelcomePageGuard({
      authHostname: AUTH,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provider: provider as any,
      cookieDomain: null,
    })
    const res = makeRes()
    const next = vi.fn()
    await mw(
      makeReq({
        cookieHeader: `dev-id=${VALID_DEV}; ses-id=${VALID_SES}`,
      }),
      res,
      next,
    )
    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('bounces when listDeviceAccounts throws', async () => {
    const provider: FakeProvider = {
      accountManager: {
        listDeviceAccounts: vi.fn().mockRejectedValue(new Error('db down')),
      },
    }
    const mw = createWelcomePageGuard({
      authHostname: AUTH,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provider: provider as any,
      cookieDomain: null,
    })
    const res = makeRes()
    const next = vi.fn()
    await mw(
      makeReq({
        cookieHeader: `dev-id=${VALID_DEV}; ses-id=${VALID_SES}`,
      }),
      res,
      next,
    )
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(303)
  })
})
