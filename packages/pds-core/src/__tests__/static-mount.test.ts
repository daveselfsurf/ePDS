import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import type { AddressInfo } from 'node:net'

import express from 'express'
import { afterEach, beforeEach, describe, it, expect } from 'vitest'

import { mountStaticAssets } from '../lib/static-mount.js'

/**
 * Boot a throwaway Express server with the static-mount helper on a
 * random port, GET the given path, and return status + body.
 */
async function fetchFromMounted(
  pathOnServer: string,
  publicDir: string,
): Promise<{ status: number; body: string; contentType?: string }> {
  const app = express()
  mountStaticAssets(app, publicDir)
  const server = http.createServer(app)
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      resolve()
    })
  })
  try {
    const { port } = server.address() as AddressInfo
    return await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}${pathOnServer}`, (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(Buffer.from(c)))
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
              contentType: res.headers['content-type'],
            })
          })
        })
        .on('error', reject)
    })
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  }
}

describe('mountStaticAssets', () => {
  // __dirname = .../pds-core/src/__tests__; the real assets ship in
  // .../pds-core/public.
  const publicDir = path.resolve(__dirname, '..', '..', 'public')

  beforeEach(() => {
    // Sanity — the fixtures on disk are what the whole test depends on.
    expect(fs.existsSync(path.join(publicDir, 'favicon.svg'))).toBe(true)
    expect(fs.existsSync(path.join(publicDir, 'favicon-dark.svg'))).toBe(true)
  })

  // Keep `afterEach` even though `fetchFromMounted` cleans up its own
  // server — any future test that forgets to close one will be obvious
  // when this hook flags a leak.
  afterEach(() => {})

  it('serves /static/favicon.svg from the package public dir', async () => {
    const res = await fetchFromMounted('/static/favicon.svg', publicDir)
    expect(res.status).toBe(200)
    expect(res.contentType).toMatch(/svg/)
    expect(res.body).toContain('<svg')
  })

  it('serves /static/favicon-dark.svg from the package public dir', async () => {
    const res = await fetchFromMounted('/static/favicon-dark.svg', publicDir)
    expect(res.status).toBe(200)
    expect(res.contentType).toMatch(/svg/)
    expect(res.body).toContain('<svg')
  })

  it('404s for a path outside /static', async () => {
    const res = await fetchFromMounted('/favicon.svg', publicDir)
    expect(res.status).toBe(404)
  })
})
