/**
 * Integration tests for /preview/emails/* routes. Bring up an express
 * app with the preview-emails router mounted, listen on an ephemeral
 * port, and hit it with fetch. The real EmailSender is not constructed
 * — we cast a minimal AuthServiceContext stub because the router only
 * reads `config.email.{from,fromName}` and `config.{hostname,pdsHostname}`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import express, { type Express } from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { createPreviewEmailsRouter } from '../routes/preview-emails.js'
import type { AuthServiceContext } from '../context.js'

function makeCtxStub(): AuthServiceContext {
  return {
    config: {
      hostname: 'auth.preview.example',
      pdsHostname: 'pds.preview.example',
      email: { from: 'noreply@pds.preview.example', fromName: 'Preview PDS' },
    },
  } as unknown as AuthServiceContext
}

let server: Server
let baseUrl: string
let app: Express

beforeAll(async () => {
  app = express()
  app.use(createPreviewEmailsRouter(makeCtxStub()))
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  const addr = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err)
      else resolve()
    })
  })
})

beforeEach(() => {
  process.env.AUTH_PREVIEW_ROUTES = '1'
})

describe('preview-emails router — gate', () => {
  it('returns 404 for every email route when AUTH_PREVIEW_ROUTES is unset', async () => {
    delete process.env.AUTH_PREVIEW_ROUTES
    for (const path of [
      '/preview/emails/new-user',
      '/preview/emails/returning-user',
      '/preview/emails/recovery',
    ]) {
      const res = await fetch(`${baseUrl}${path}`)
      expect(res.status).toBe(404)
    }
  })
})

describe('preview-emails router — rendering', () => {
  it('renders the new-user welcome email inside an iframe with srcdoc', async () => {
    const res = await fetch(`${baseUrl}/preview/emails/new-user?otp=123456`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.text()
    expect(body).toContain('New user')
    expect(body).toContain('auth.preview.example') // pdsName in subject
    expect(body).toContain('<iframe')
    expect(body).toContain('sandbox=""')
    expect(body).toContain('srcdoc="')
    // The real sender's welcome HTML, escaped for the srcdoc attribute.
    expect(body).toContain('Welcome to auth.preview.example')
  })

  it('renders the returning-user OTP email with the app name', async () => {
    const res = await fetch(
      `${baseUrl}/preview/emails/returning-user?otp=12345678&app=MyApp`,
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('Returning user')
    expect(body).toContain('MyApp')
    expect(body).toContain('1234 5678') // formatted in subject
  })

  it('renders the recovery email with the backup verification URL', async () => {
    const url = 'https://auth.preview.example/account/verify?t=xyz'
    const res = await fetch(
      `${baseUrl}/preview/emails/recovery?verify_url=${encodeURIComponent(url)}`,
    )
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('Account recovery')
    expect(body).toContain('Verify your backup email')
    // The URL lives inside the iframe's srcdoc attribute, so it is
    // HTML-escaped twice: once for the email HTML, once for the attribute.
    // A substring of the path is enough to prove it made it through.
    expect(body).toContain('verify?t=xyz')
  })

  it('exposes from/to/subject headers in the preview shell', async () => {
    const res = await fetch(
      `${baseUrl}/preview/emails/returning-user?to=bob@test.example`,
    )
    const body = await res.text()
    expect(body).toContain('Preview PDS')
    expect(body).toContain('noreply@pds.preview.example')
    expect(body).toContain('bob@test.example')
  })
})
