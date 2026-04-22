import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import type { AddressInfo } from 'node:net'

import express from 'express'
import { afterAll, beforeAll, describe, it, expect } from 'vitest'

import { mountStaticAssets } from '../static-mount.js'

const LIGHT_SVG = '<svg data-variant="light"><!-- light --></svg>'
const DARK_SVG = '<svg data-variant="dark"><!-- dark --></svg>'

let fixtureDir: string

beforeAll(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-mount-'))
  fs.writeFileSync(path.join(fixtureDir, 'favicon.svg'), LIGHT_SVG)
  fs.writeFileSync(path.join(fixtureDir, 'favicon-dark.svg'), DARK_SVG)
})

afterAll(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true })
})

/**
 * Boot a throwaway Express server with the static-mount helper on a
 * random port, GET the given path, and return status + body.
 */
async function fetchFromMounted(
  pathOnServer: string,
): Promise<{ status: number; body: string; contentType?: string }> {
  const app = express()
  mountStaticAssets(app, fixtureDir)
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
  it('serves /static/favicon.svg from the given public dir', async () => {
    const res = await fetchFromMounted('/static/favicon.svg')
    expect(res.status).toBe(200)
    expect(res.contentType).toMatch(/svg/)
    expect(res.body).toBe(LIGHT_SVG)
  })

  it('serves /static/favicon-dark.svg from the given public dir', async () => {
    const res = await fetchFromMounted('/static/favicon-dark.svg')
    expect(res.status).toBe(200)
    expect(res.contentType).toMatch(/svg/)
    expect(res.body).toBe(DARK_SVG)
  })

  it('404s for a path outside /static and not the /favicon.ico alias', async () => {
    const res = await fetchFromMounted('/not-a-real-path')
    expect(res.status).toBe(404)
  })

  it('aliases /favicon.ico to the light-theme SVG', async () => {
    const res = await fetchFromMounted('/favicon.ico')
    expect(res.status).toBe(200)
    expect(res.contentType).toMatch(/svg/)
    expect(res.body).toBe(LIGHT_SVG)
  })
})
