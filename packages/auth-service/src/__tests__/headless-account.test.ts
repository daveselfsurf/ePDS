/**
 * Integration tests for the headless direct account-creation endpoint
 * (POST /_internal/account/create).
 *
 * Mounts the real headless router on an ephemeral express server with a
 * real EpdsDb and a stubbed better-auth instance. Covers the auth/validation
 * surface that runs BEFORE any pds-core call: API-key rejection, origin and
 * rate-limit checks, the can_create_directly permission gate, and handle/
 * email validation. The account-minting path (handleSignup -> invite ->
 * com.atproto.server.createAccount) is covered by end-to-end staging tests,
 * since it requires a live pds-core.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

function createTestClient(
  overrides: Partial<{
    apiKey: string
    allowedOrigins: string | null
    rateLimitPerHour: number
    canCreateDirectly: boolean
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
    canCreateDirectly: overrides.canCreateDirectly ?? true,
    rateLimitPerHour: overrides.rateLimitPerHour ?? 10000,
  })
  return { apiKey }
}

beforeAll(async () => {
  dbPath = path.join(
    os.tmpdir(),
    `epds-account-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  )
  db = new EpdsDb(dbPath)

  // Stub better-auth — the account-create path never calls it, but the
  // router constructor requires an instance.
  const auth = {
    api: {
      sendVerificationOTP() {
        return Promise.resolve()
      },
      signInEmailOTP() {
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

describe('POST /_internal/account/create', () => {
  it('rejects a missing/invalid API key with 401', async () => {
    const res = await post('/_internal/account/create', {
      handle: 'communityone',
      email: 'community-abc123@example.internal',
    })
    expect(res.status).toBe(401)
    expect(res.json.error).toBe('Unauthorized')
  })

  it('rejects a client lacking can_create_directly with 403', async () => {
    const { apiKey } = createTestClient({ canCreateDirectly: false })
    const res = await post(
      '/_internal/account/create',
      { handle: 'communityone', email: 'community-abc123@example.internal' },
      { 'x-api-key': apiKey },
    )
    expect(res.status).toBe(403)
    expect(res.json.error).toBe('DirectCreateNotAllowed')
  })

  it('rejects a disallowed origin with 403', async () => {
    const { apiKey } = createTestClient({
      allowedOrigins: 'https://allowed.example.com',
    })
    const res = await post(
      '/_internal/account/create',
      { handle: 'communityone', email: 'community-abc123@example.internal' },
      { 'x-api-key': apiKey, origin: 'https://evil.example.com' },
    )
    expect(res.status).toBe(403)
    expect(res.json.error).toBe('OriginNotAllowed')
  })

  it('rejects missing handle/email with 400', async () => {
    const { apiKey } = createTestClient()
    const res = await post(
      '/_internal/account/create',
      { email: 'community-abc123@example.internal' },
      { 'x-api-key': apiKey },
    )
    expect(res.status).toBe(400)
  })

  it('rejects an invalid handle (contains a dot) with 400 InvalidHandle', async () => {
    const { apiKey } = createTestClient()
    const res = await post(
      '/_internal/account/create',
      { handle: 'has.dot', email: 'community-abc123@example.internal' },
      { 'x-api-key': apiKey },
    )
    expect(res.status).toBe(400)
    expect(res.json.error).toBe('InvalidHandle')
  })

  it('rejects a handle that is too short with 400 InvalidHandle', async () => {
    const { apiKey } = createTestClient()
    const res = await post(
      '/_internal/account/create',
      { handle: 'ab', email: 'community-abc123@example.internal' },
      { 'x-api-key': apiKey },
    )
    expect(res.status).toBe(400)
    expect(res.json.error).toBe('InvalidHandle')
  })

  it('rejects a handle that is too long with 400 InvalidHandle', async () => {
    const { apiKey } = createTestClient()
    const res = await post(
      '/_internal/account/create',
      {
        handle: 'thishandleiswaytoolongtobevalid',
        email: 'community-abc123@example.internal',
      },
      { 'x-api-key': apiKey },
    )
    expect(res.status).toBe(400)
    expect(res.json.error).toBe('InvalidHandle')
  })
})
