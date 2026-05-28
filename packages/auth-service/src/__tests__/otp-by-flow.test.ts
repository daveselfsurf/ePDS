/**
 * Tests for the flow-keyed OTP endpoints used by the OAuth login page's
 * handle path (/auth/otp/send-by-flow, /auth/otp/verify-by-flow). The
 * browser sends no email — the server resolves it from the auth_flow row
 * keyed by the epds_auth_flow cookie.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'
import express, { type Express } from 'express'
import cookieParser from 'cookie-parser'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { EpdsDb } from '@certified-app/shared'
import { createOtpByFlowRouter } from '../routes/otp-by-flow.js'
import type { AuthServiceContext } from '../context.js'

let db: EpdsDb
let dbPath: string
let server: Server
let baseUrl: string
let app: Express
let sentOtps: Array<{ email: string }>

beforeAll(async () => {
  dbPath = path.join(
    os.tmpdir(),
    `epds-otpflow-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  )
  db = new EpdsDb(dbPath)
  sentOtps = []

  const auth = {
    api: {
      sendVerificationOTP({ body }: { body: { email: string } }) {
        sentOtps.push({ email: body.email })
        return Promise.resolve()
      },
      signInEmailOTP({ body }: { body: { email: string; otp: string } }) {
        if (body.otp !== 'GOOD-OTP') {
          return Promise.reject(new Error('invalid otp'))
        }
        // Mimic better-auth asResponse:true returning a Response with a cookie.
        return Promise.resolve(
          new Response(null, {
            headers: { 'set-cookie': 'better-auth.session=abc; Path=/' },
          }),
        )
      },
    },
  }

  const ctx = { db } as unknown as AuthServiceContext

  app = express()
  app.use(express.json())
  app.use(cookieParser())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use(createOtpByFlowRouter(ctx, auth as any))
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err)
      else resolve()
    })
  })
  db.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix)
      // eslint-disable-next-line no-empty
    } catch {}
  }
})

beforeEach(() => {
  sentOtps = []
})

function makeFlow(email: string | null): string {
  const flowId = `flow-${Math.random().toString(36).slice(2)}`
  db.createAuthFlow({
    flowId,
    requestUri: `urn:req:${flowId}`,
    clientId: null,
    email,
    expiresAt: Date.now() + 600_000,
  })
  return flowId
}

async function post(
  routePath: string,
  body: unknown,
  flowId?: string,
): Promise<{ status: number; json: Record<string, unknown>; setCookie: string | null }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (flowId) headers['Cookie'] = `epds_auth_flow=${flowId}`
  const res = await fetch(`${baseUrl}${routePath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') }
}

describe('POST /auth/otp/send-by-flow', () => {
  it('sends the OTP to the flow-stored email', async () => {
    const flowId = makeFlow('dave@attpslabs.com')
    const res = await post('/auth/otp/send-by-flow', {}, flowId)
    expect(res.status).toBe(200)
    expect(res.json.ok).toBe(true)
    expect(sentOtps).toEqual([{ email: 'dave@attpslabs.com' }])
  })

  it('returns ok without sending when there is no flow cookie (anti-enumeration)', async () => {
    const res = await post('/auth/otp/send-by-flow', {})
    expect(res.status).toBe(200)
    expect(res.json.ok).toBe(true)
    expect(sentOtps).toHaveLength(0)
  })

  it('returns ok without sending when the flow has no email', async () => {
    const flowId = makeFlow(null)
    const res = await post('/auth/otp/send-by-flow', {}, flowId)
    expect(res.status).toBe(200)
    expect(res.json.ok).toBe(true)
    expect(sentOtps).toHaveLength(0)
  })
})

describe('POST /auth/otp/verify-by-flow', () => {
  it('rejects a missing otp with 400', async () => {
    const flowId = makeFlow('dave@attpslabs.com')
    const res = await post('/auth/otp/verify-by-flow', {}, flowId)
    expect(res.status).toBe(400)
  })

  it('returns SessionExpired (400) when there is no flow/email', async () => {
    const res = await post('/auth/otp/verify-by-flow', { otp: 'GOOD-OTP' })
    expect(res.status).toBe(400)
    expect(res.json.error).toBe('SessionExpired')
  })

  it('returns InvalidCode (400) on a wrong code', async () => {
    const flowId = makeFlow('dave@attpslabs.com')
    const res = await post('/auth/otp/verify-by-flow', { otp: 'WRONG' }, flowId)
    expect(res.status).toBe(400)
    expect(res.json.error).toBe('InvalidCode')
  })

  it('verifies and forwards the session Set-Cookie on success', async () => {
    const flowId = makeFlow('dave@attpslabs.com')
    const res = await post('/auth/otp/verify-by-flow', { otp: 'GOOD-OTP' }, flowId)
    expect(res.status).toBe(200)
    expect(res.json.ok).toBe(true)
    expect(res.setCookie).toContain('better-auth.session=abc')
  })
})
