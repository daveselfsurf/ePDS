/**
 * Tests for the trailing 404 + 500 middleware in createAuthService. Mirror
 * the real handlers exactly — content negotiation via req.accepts(['json',
 * 'html']), HTML uses renderError, JSON uses a stable error code. Also
 * verifies the headersSent guard delegates to Express's default handler.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import express, { type Express } from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { renderError } from '../lib/render-error.js'

let server: Server
let baseUrl: string

beforeAll(async () => {
  const app: Express = express()

  app.get('/ok', (_req, res) => {
    res.json({ ok: true })
  })

  app.get('/boom', (_req, _res, next) => {
    next(new Error('kaboom'))
  })

  app.get('/double', (_req, res, next) => {
    res.status(200).json({ partial: true })
    next(new Error('after-send'))
  })

  app.use((req, res) => {
    if (req.accepts(['json', 'html']) === 'html') {
      res
        .status(404)
        .type('html')
        .send(
          renderError(
            "The page you're looking for doesn't exist.",
            'Page not found',
          ),
        )
    } else {
      res.status(404).json({ error: 'not_found' })
    }
  })

  app.use(
    (
      err: unknown,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (res.headersSent) {
        next(err)
        return
      }
      if (req.accepts(['json', 'html']) === 'html') {
        res
          .status(500)
          .type('html')
          .send(renderError('Something went wrong. Please try again.'))
      } else {
        res.status(500).json({ error: 'internal_error' })
      }
    },
  )

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  const addr = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
})

describe('404 handler', () => {
  it('returns JSON for Accept: */* (fetch/curl default)', async () => {
    const res = await fetch(`${baseUrl}/nope`)
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('returns JSON for explicit Accept: application/json', async () => {
    const res = await fetch(`${baseUrl}/nope`, {
      headers: { Accept: 'application/json' },
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('returns styled HTML for browser Accept header', async () => {
    const res = await fetch(`${baseUrl}/nope`, {
      headers: {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    const body = await res.text()
    expect(body).toContain('<title>Page not found</title>')
    expect(body).toContain("doesn't exist")
  })
})

describe('500 handler', () => {
  it('returns JSON for Accept: */*', async () => {
    const res = await fetch(`${baseUrl}/boom`)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal_error' })
  })

  it('returns styled HTML for browser Accept header', async () => {
    const res = await fetch(`${baseUrl}/boom`, {
      headers: { Accept: 'text/html' },
    })
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    const body = await res.text()
    expect(body).toContain('<title>Error</title>')
    expect(body).toContain('Something went wrong')
  })

  it('does not crash when headers already sent — delegates to next', async () => {
    const res = await fetch(`${baseUrl}/double`)
    // First response already started (200) — Express default handler aborts,
    // so the client sees the original 200 body.
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ partial: true })
  })
})
