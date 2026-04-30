import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import { installTestHooks } from '../lib/test-hooks.js'

// Minimal Kysely-like update query mock: chains `.set().where()*.executeTakeFirst()`
// and records what was called for assertions. Enough for the hook —
// `installTestHooks` only ever calls these four chain methods.
function makeFakeUpdate() {
  const wheres: Array<[string, string, unknown]> = []
  let setVals: Record<string, unknown> = {}
  let result: { numUpdatedRows: number | bigint } = { numUpdatedRows: 0 }
  const chain = {
    set(vals: Record<string, unknown>) {
      setVals = vals
      return chain
    },
    where(col: string, op: string, val: unknown) {
      wheres.push([col, op, val])
      return chain
    },
    executeTakeFirst() {
      return Promise.resolve(result)
    },
  }
  return {
    chain,
    setUpdatedRows(n: number | bigint) {
      result = { numUpdatedRows: n }
    },
    inspect() {
      return { setVals, wheres }
    },
  }
}

function makeFakePds(opts: {
  fakeUpdate: ReturnType<typeof makeFakeUpdate>
  failOnExecute?: boolean
}) {
  return {
    ctx: {
      accountManager: {
        db: {
          db: {
            updateTable: (table: string) => {
              expect(table).toBe('account_device')
              if (opts.failOnExecute) {
                return {
                  set: () => ({
                    where: () => ({
                      executeTakeFirst: () =>
                        Promise.reject(new Error('db down')),
                    }),
                  }),
                }
              }
              return opts.fakeUpdate.chain
            },
          },
        },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

async function postHook(
  app: express.Express,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const server = app.listen(0)
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.once('listening', () => {
      const addr = server.address()
      if (typeof addr === 'object' && addr) resolve(addr.port)
      else reject(new Error('Failed to resolve ephemeral port'))
    })
  })
  server.unref()
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/_internal/test/expire-device-account`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      },
    )
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { status: res.status, json }
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  }
}

describe('installTestHooks — expire-device-account', () => {
  let priorEnv: { hooks?: string; secret?: string; node?: string } = {}

  beforeEach(() => {
    priorEnv = {
      hooks: process.env.EPDS_TEST_HOOKS,
      secret: process.env.EPDS_INTERNAL_SECRET,
      node: process.env.NODE_ENV,
    }
    delete process.env.NODE_ENV
    process.env.EPDS_INTERNAL_SECRET = 'test-secret-1234'
  })

  afterEach(() => {
    if (priorEnv.hooks === undefined) delete process.env.EPDS_TEST_HOOKS
    else process.env.EPDS_TEST_HOOKS = priorEnv.hooks
    if (priorEnv.secret === undefined) delete process.env.EPDS_INTERNAL_SECRET
    else process.env.EPDS_INTERNAL_SECRET = priorEnv.secret
    if (priorEnv.node === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = priorEnv.node
  })

  it('does nothing when EPDS_TEST_HOOKS is unset', async () => {
    delete process.env.EPDS_TEST_HOOKS
    const fakeUpdate = makeFakeUpdate()
    const app = express()
    installTestHooks({
      pds: makeFakePds({ fakeUpdate }),
      app,
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const res = await postHook(
      app,
      { did: 'did:plc:a' },
      { 'x-internal-secret': 'test-secret-1234' },
    )
    // Route was never mounted, so the request 404s before any auth check.
    expect(res.status).toBe(404)
  })

  it('refuses to install when NODE_ENV=production', () => {
    process.env.EPDS_TEST_HOOKS = '1'
    process.env.NODE_ENV = 'production'
    const fakeUpdate = makeFakeUpdate()
    const app = express()
    expect(() => {
      installTestHooks({
        pds: makeFakePds({ fakeUpdate }),
        app,
        logger: { warn: vi.fn(), error: vi.fn() },
      })
    }).toThrow(/production/i)
  })

  it('rejects requests without the internal secret', async () => {
    process.env.EPDS_TEST_HOOKS = '1'
    const fakeUpdate = makeFakeUpdate()
    const app = express()
    installTestHooks({
      pds: makeFakePds({ fakeUpdate }),
      app,
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const res = await postHook(app, { did: 'did:plc:a' })
    expect(res.status).toBe(401)
  })

  it('rejects requests with the wrong secret', async () => {
    process.env.EPDS_TEST_HOOKS = '1'
    const fakeUpdate = makeFakeUpdate()
    const app = express()
    installTestHooks({
      pds: makeFakePds({ fakeUpdate }),
      app,
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const res = await postHook(
      app,
      { did: 'did:plc:a' },
      { 'x-internal-secret': 'wrong' },
    )
    expect(res.status).toBe(401)
  })

  it('rejects requests missing the did', async () => {
    process.env.EPDS_TEST_HOOKS = '1'
    const fakeUpdate = makeFakeUpdate()
    const app = express()
    installTestHooks({
      pds: makeFakePds({ fakeUpdate }),
      app,
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const res = await postHook(
      app,
      {},
      { 'x-internal-secret': 'test-secret-1234' },
    )
    expect(res.status).toBe(400)
    expect(String(res.json.error)).toMatch(/did/i)
  })

  it('backdates every device row for the did when no deviceId is given', async () => {
    process.env.EPDS_TEST_HOOKS = '1'
    const fakeUpdate = makeFakeUpdate()
    fakeUpdate.setUpdatedRows(2)
    const logger = { warn: vi.fn(), error: vi.fn() }
    const app = express()
    installTestHooks({
      pds: makeFakePds({ fakeUpdate }),
      app,
      logger,
    })

    const res = await postHook(
      app,
      { did: 'did:plc:a' },
      { 'x-internal-secret': 'test-secret-1234' },
    )

    expect(res.status).toBe(200)
    expect(res.json.updated).toBe(2)
    const { setVals, wheres } = fakeUpdate.inspect()
    // updatedAt is set to an ISO string ~8 days in the past.
    const updatedAt = setVals.updatedAt as string
    expect(typeof updatedAt).toBe('string')
    const past = new Date(updatedAt).getTime()
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000
    expect(Math.abs(past - eightDaysAgo)).toBeLessThan(60_000)
    // Only one WHERE clause: did. No deviceId narrowing.
    expect(wheres).toEqual([['did', '=', 'did:plc:a']])
  })

  it('narrows by deviceId when both keys are provided', async () => {
    process.env.EPDS_TEST_HOOKS = '1'
    const fakeUpdate = makeFakeUpdate()
    fakeUpdate.setUpdatedRows(1)
    const app = express()
    installTestHooks({
      pds: makeFakePds({ fakeUpdate }),
      app,
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const res = await postHook(
      app,
      { did: 'did:plc:a', deviceId: 'dev-deadbeef' },
      { 'x-internal-secret': 'test-secret-1234' },
    )

    expect(res.status).toBe(200)
    expect(res.json.updated).toBe(1)
    const { wheres } = fakeUpdate.inspect()
    expect(wheres).toEqual([
      ['did', '=', 'did:plc:a'],
      ['deviceId', '=', 'dev-deadbeef'],
    ])
  })

  it('returns 500 and logs when the underlying update throws', async () => {
    process.env.EPDS_TEST_HOOKS = '1'
    const fakeUpdate = makeFakeUpdate()
    const logger = { warn: vi.fn(), error: vi.fn() }
    const app = express()
    installTestHooks({
      pds: makeFakePds({ fakeUpdate, failOnExecute: true }),
      app,
      logger,
    })

    const res = await postHook(
      app,
      { did: 'did:plc:a' },
      { 'x-internal-secret': 'test-secret-1234' },
    )

    expect(res.status).toBe(500)
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ did: 'did:plc:a' }),
      expect.stringContaining('Failed to backdate'),
    )
  })

  it('coerces bigint numUpdatedRows to a regular Number', async () => {
    // Kysely's actual return type is `bigint` on better-sqlite3 driver.
    process.env.EPDS_TEST_HOOKS = '1'
    const fakeUpdate = makeFakeUpdate()
    fakeUpdate.setUpdatedRows(BigInt(3))
    const app = express()
    installTestHooks({
      pds: makeFakePds({ fakeUpdate }),
      app,
      logger: { warn: vi.fn(), error: vi.fn() },
    })

    const res = await postHook(
      app,
      { did: 'did:plc:a' },
      { 'x-internal-secret': 'test-secret-1234' },
    )

    expect(res.status).toBe(200)
    expect(res.json.updated).toBe(3)
    expect(typeof res.json.updated).toBe('number')
  })
})
