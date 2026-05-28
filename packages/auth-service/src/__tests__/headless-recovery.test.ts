/**
 * Integration tests for the headless recovery endpoints
 * (POST /_internal/recovery/send and /_internal/recovery/verify).
 *
 * Mounts the real headless router on an ephemeral express server with a
 * real EpdsDb and a stubbed better-auth instance. Covers the auth/validation
 * surface that runs BEFORE any better-auth or pds-core call: API-key
 * rejection, field validation, and anti-enumeration on /send. The token
 * minting path (verify -> resolveRecoveryEmail -> handleLogin) is covered by
 * end-to-end staging tests, since it requires a live pds-core.
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
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { EpdsDb } from '@certified-app/shared'
import { createHeadlessOtpRouter } from '../routes/headless-otp.js'
import type { AuthServiceContext } from '../context.js'
import type { BetterAuthInstance } from '../better-auth.js'

let db: EpdsDb
let dbPath: string
let server: Server
let baseUrl: string
let app: Express
let sentOtps: Array<{ email: string; type: string }>

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

function createTestClient(
  overrides: Partial<{
    apiKey: string
    allowedOrigins: string | null
    rateLimitPerHour: number
  }> = {},
): { apiKey: string } {
  const apiKey = overrides.apiKey ?? randomBytes(32).toString('hex')
  db.createApiClient({
    id: randomUUID(),
    name: 'TestApp',
    clientId: null,
    apiKeyHash: hashKey(apiKey),
    allowedOrigins: overrides.allowedOrigins ?? null,
    canSignup: true,
    rateLimitPerHour: overrides.rateLimitPerHour ?? 10000,
  })
  return { apiKey }
}

function addVerifiedBackupEmail(did: string, email: string): void {
  const tokenHash = hashKey(randomBytes(16).toString('hex'))
  db.addBackupEmail(did, email, tokenHash)
  db.verifyBackupEmail(tokenHash)
}

beforeAll(async () => {
  dbPath = path.join(
    os.tmpdir(),
    `epds-recovery-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  )
  db = new EpdsDb(dbPath)

  // Stub better-auth: record OTP sends, accept "good-otp" on verify.
  sentOtps = []
  const auth = {
    api: {
      sendVerificationOTP({
        body,
      }: {
        body: { email: string; type: string }
      }) {
        sentOtps.push({ email: body.email, type: body.type })
        return Promise.resolve()
      },
      signInEmailOTP({ body }: { body: { email: string; otp: string } }) {
        if (body.otp !== 'GOOD-OTP') {
          return Promise.reject(new Error('invalid otp'))
        }
        return Promise.resolve({ token: 'stub' })
      },
    },
  } as unknown as BetterAuthInstance

  const ctx = { db } as unknown as AuthServiceContext

  app = express()
  app.use(express.json())
  app.use(createHeadlessOtpRouter(ctx, auth))
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

async function post(
  routePath: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${routePath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, json }
}

describe('POST /_internal/recovery/send', () => {
  it('rejects a missing/invalid API key with 401', async () => {
    const res = await post('/_internal/recovery/send', {
      backupEmail: 'backup@example.com',
    })
    expect(res.status).toBe(401)
    expect(res.json.error).toBe('Unauthorized')
  })

  it('rejects a missing backupEmail with 400', async () => {
    const { apiKey } = createTestClient()
    const res = await post(
      '/_internal/recovery/send',
      {},
      { 'x-api-key': apiKey },
    )
    expect(res.status).toBe(400)
  })

  it('returns success but sends NO OTP when the backup email is unknown (anti-enumeration)', async () => {
    const { apiKey } = createTestClient()
    const res = await post(
      '/_internal/recovery/send',
      { backupEmail: 'nobody@example.com' },
      { 'x-api-key': apiKey },
    )
    expect(res.status).toBe(200)
    expect(res.json.success).toBe(true)
    expect(sentOtps).toHaveLength(0)
  })

  it('sends an OTP to the backup email when it is a verified backup', async () => {
    const { apiKey } = createTestClient()
    addVerifiedBackupEmail('did:plc:test123', 'backup@example.com')

    const res = await post(
      '/_internal/recovery/send',
      { backupEmail: 'Backup@Example.com' },
      { 'x-api-key': apiKey },
    )
    expect(res.status).toBe(200)
    expect(res.json.success).toBe(true)
    expect(sentOtps).toHaveLength(1)
    // OTP must go to the backup email (lowercased), not a primary email.
    expect(sentOtps[0]).toEqual({
      email: 'backup@example.com',
      type: 'sign-in',
    })
  })
})

describe('POST /_internal/recovery/verify', () => {
  it('rejects a missing/invalid API key with 401', async () => {
    const res = await post('/_internal/recovery/verify', {
      backupEmail: 'backup@example.com',
      otp: 'GOOD-OTP',
    })
    expect(res.status).toBe(401)
  })

  it('rejects missing fields with 400', async () => {
    const { apiKey } = createTestClient()
    const res = await post(
      '/_internal/recovery/verify',
      { backupEmail: 'backup@example.com' },
      { 'x-api-key': apiKey },
    )
    expect(res.status).toBe(400)
  })

  it('returns InvalidCode (400) when the OTP is wrong', async () => {
    const { apiKey } = createTestClient()
    addVerifiedBackupEmail('did:plc:wrongotp', 'wrongotp-backup@example.com')

    const res = await post(
      '/_internal/recovery/verify',
      { backupEmail: 'wrongotp-backup@example.com', otp: 'WRONG' },
      { 'x-api-key': apiKey },
    )
    expect(res.status).toBe(400)
    expect(res.json.error).toBe('InvalidCode')
  })
})
