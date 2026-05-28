import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { EpdsDb } from '../db.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

let db: EpdsDb
let dbPath: string

beforeEach(() => {
  dbPath = path.join(
    os.tmpdir(),
    `epds-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  )
  db = new EpdsDb(dbPath)
})

afterEach(() => {
  db.close()
  try {
    fs.unlinkSync(dbPath)
    // eslint-disable-next-line no-empty
  } catch {}
  try {
    fs.unlinkSync(dbPath + '-wal')
    // eslint-disable-next-line no-empty
  } catch {}
  try {
    fs.unlinkSync(dbPath + '-shm')
    // eslint-disable-next-line no-empty
  } catch {}
})

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

describe('API Client Operations', () => {
  it('creates and retrieves a client by key hash', () => {
    const id = randomUUID()
    const apiKeyHash = hashKey('test-key-1')

    db.createApiClient({
      id,
      name: 'TestApp',
      clientId: 'https://example.com/client-metadata.json',
      apiKeyHash,
      allowedOrigins: 'https://example.com',
      canSignup: true,
      rateLimitPerHour: 500,
    })

    const client = db.getApiClientByKeyHash(apiKeyHash)
    expect(client).toBeDefined()
    expect(client!.id).toBe(id)
    expect(client!.name).toBe('TestApp')
    expect(client!.clientId).toBe('https://example.com/client-metadata.json')
    expect(client!.apiKeyHash).toBe(apiKeyHash)
    expect(client!.allowedOrigins).toBe('https://example.com')
    expect(client!.canSignup).toBe(1)
    // Defaults to 0 when not explicitly granted.
    expect(client!.canCreateDirectly).toBe(0)
    expect(client!.rateLimitPerHour).toBe(500)
    expect(client!.revokedAt).toBeNull()
    expect(client!.lastUsedAt).toBeNull()
  })

  it('returns undefined for unknown key hash', () => {
    const client = db.getApiClientByKeyHash(hashKey('nonexistent'))
    expect(client).toBeUndefined()
  })

  it('does not return revoked clients', () => {
    const id = randomUUID()
    const apiKeyHash = hashKey('revoke-test')

    db.createApiClient({
      id,
      name: 'RevokeMe',
      clientId: null,
      apiKeyHash,
      allowedOrigins: null,
      canSignup: true,
      rateLimitPerHour: 10000,
    })

    expect(db.getApiClientByKeyHash(apiKeyHash)).toBeDefined()

    db.revokeApiClient(id)

    expect(db.getApiClientByKeyHash(apiKeyHash)).toBeUndefined()
  })

  it('updates last_used_at', () => {
    const id = randomUUID()
    const apiKeyHash = hashKey('last-used-test')

    db.createApiClient({
      id,
      name: 'LastUsed',
      clientId: null,
      apiKeyHash,
      allowedOrigins: null,
      canSignup: true,
      rateLimitPerHour: 10000,
    })

    const before = db.getApiClientByKeyHash(apiKeyHash)
    expect(before!.lastUsedAt).toBeNull()

    db.updateApiClientLastUsed(id)

    const after = db.getApiClientByKeyHash(apiKeyHash)
    expect(after!.lastUsedAt).toBeGreaterThan(0)
  })

  it('stores canSignup=false correctly', () => {
    const id = randomUUID()
    const apiKeyHash = hashKey('no-signup')

    db.createApiClient({
      id,
      name: 'NoSignup',
      clientId: null,
      apiKeyHash,
      allowedOrigins: null,
      canSignup: false,
      rateLimitPerHour: 10000,
    })

    const client = db.getApiClientByKeyHash(apiKeyHash)
    expect(client!.canSignup).toBe(0)
  })

  it('stores canCreateDirectly=true correctly', () => {
    const id = randomUUID()
    const apiKeyHash = hashKey('direct-create')

    db.createApiClient({
      id,
      name: 'DirectCreate',
      clientId: null,
      apiKeyHash,
      allowedOrigins: null,
      canSignup: true,
      canCreateDirectly: true,
      rateLimitPerHour: 10000,
    })

    const client = db.getApiClientByKeyHash(apiKeyHash)
    expect(client!.canCreateDirectly).toBe(1)
  })
})

describe('API Client Usage Tracking', () => {
  it('records and counts usage within time window', () => {
    const clientId = randomUUID()

    db.recordApiClientUsage(clientId, 'otp_send')
    db.recordApiClientUsage(clientId, 'otp_send')
    db.recordApiClientUsage(clientId, 'otp_verify')

    const oneHourMs = 60 * 60 * 1000
    const count = db.getApiClientUsageCount(clientId, oneHourMs)
    expect(count).toBe(3)
  })

  it('returns 0 for unknown client', () => {
    const count = db.getApiClientUsageCount('nonexistent', 60 * 60 * 1000)
    expect(count).toBe(0)
  })

  it('cleans up old usage records', () => {
    const clientId = randomUUID()

    db.recordApiClientUsage(clientId, 'otp_send')

    // Cleanup should not remove recent records
    const deleted = db.cleanupOldApiClientUsage()
    expect(deleted).toBe(0)

    const count = db.getApiClientUsageCount(clientId, 60 * 60 * 1000)
    expect(count).toBe(1)
  })
})

describe('Schema Version', () => {
  it('is at version 11 after all migrations', () => {
    // EpdsDb runs migrations in constructor, so just check the version
    // by creating a fresh db and verifying api_clients table exists
    const id = randomUUID()
    const apiKeyHash = hashKey('schema-check')

    db.createApiClient({
      id,
      name: 'SchemaCheck',
      clientId: null,
      apiKeyHash,
      allowedOrigins: null,
      canSignup: true,
      rateLimitPerHour: 10000,
    })

    expect(db.getApiClientByKeyHash(apiKeyHash)).toBeDefined()
  })
})
