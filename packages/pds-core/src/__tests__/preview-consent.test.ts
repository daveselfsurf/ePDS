import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createPreviewConsentHandler,
  renderPreviewIndex,
} from '../lib/preview-consent.js'

function mockLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}

type CapturedRes = {
  headers: Record<string, string>
  body: string | null
  setHeader: (name: string, value: string) => void
  send: (body: string) => void
}

function mockRes(): CapturedRes {
  const res: CapturedRes = {
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value
    },
    send(body) {
      this.body = body
    },
  }
  return res
}

describe('createPreviewConsentHandler', () => {
  const originalEnv = process.env.PDS_PREVIEW_ROUTES

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PDS_PREVIEW_ROUTES
    else process.env.PDS_PREVIEW_ROUTES = originalEnv
    vi.restoreAllMocks()
  })

  it('returns null when PDS_PREVIEW_ROUTES is unset', () => {
    delete process.env.PDS_PREVIEW_ROUTES
    const handler = createPreviewConsentHandler({
      trustedClients: [],
      resolveClientMetadata: () => Promise.resolve({}),
      getClientCss: () => null,
      logger: mockLogger(),
    })
    expect(handler).toBeNull()
  })

  it('returns null when PDS_PREVIEW_ROUTES is not "1"', () => {
    process.env.PDS_PREVIEW_ROUTES = '0'
    const handler = createPreviewConsentHandler({
      trustedClients: [],
      resolveClientMetadata: () => Promise.resolve({}),
      getClientCss: () => null,
      logger: mockLogger(),
    })
    expect(handler).toBeNull()
  })

  describe('when enabled', () => {
    beforeEach(() => {
      process.env.PDS_PREVIEW_ROUTES = '1'
    })

    it('renders fixture consent HTML with default client id when none provided', async () => {
      const handler = createPreviewConsentHandler({
        trustedClients: [],
        resolveClientMetadata: () => Promise.resolve({}),
        getClientCss: () => null,
        logger: mockLogger(),
      })!
      const res = mockRes()
      await handler({ query: {} }, res)

      expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8')
      expect(res.headers['Cache-Control']).toBe('no-store')
      expect(res.headers['Content-Security-Policy']).toContain(
        "script-src 'self' 'unsafe-inline'",
      )
      expect(res.body).toContain('preview.example/client-metadata.json')
      // Drives the SPA to the consent view, not sign-in. The hydration
      // data is JSON-stringified twice (once for the value, once for the
      // script-literal), so field names appear with escaped quotes.
      expect(res.body).toContain('\\"consentRequired\\":true')
      expect(res.body).toContain('\\"selected\\":true')
      // No loginHint — would force sign-in mode in authorize-view.tsx:
      expect(res.body).not.toContain('\\"loginHint\\"')
      // Hydration script + entry bundle present:
      expect(res.body).toMatch(
        /<script>window\["__authorizeData"\]=JSON\.parse/,
      )
      expect(res.body).toContain('/@atproto/oauth-provider/~assets/')
    })

    it('resolves client metadata and injects CSS for custom client_id', async () => {
      const trusted = 'https://trusted.example/client-metadata.json'
      const resolveClientMetadata = vi.fn(() =>
        Promise.resolve({ client_name: 'Trusted App' }),
      )
      const getClientCss = vi.fn(() => 'body { color: red; }')
      const logger = mockLogger()

      const handler = createPreviewConsentHandler({
        trustedClients: [trusted],
        resolveClientMetadata,
        getClientCss,
        logger,
      })!
      const res = mockRes()
      await handler({ query: { client_id: trusted } }, res)

      expect(resolveClientMetadata).toHaveBeenCalledWith(trusted)
      expect(getClientCss).toHaveBeenCalledWith(
        trusted,
        { client_name: 'Trusted App' },
        [trusted],
      )
      expect(res.body).toContain('<style>body { color: red; }</style>')
      expect(res.body).toContain('\\"clientTrusted\\":true')
      expect(res.body).toContain('trusted.example')
    })

    it('marks clientTrusted=false when client_id is not in trustedClients', async () => {
      const handler = createPreviewConsentHandler({
        trustedClients: ['https://other.example/client-metadata.json'],
        resolveClientMetadata: () => Promise.resolve({}),
        getClientCss: () => null,
        logger: mockLogger(),
      })!
      const res = mockRes()
      await handler(
        {
          query: {
            client_id: 'https://untrusted.example/client-metadata.json',
          },
        },
        res,
      )
      expect(res.body).toContain('\\"clientTrusted\\":false')
    })

    it('logs a warning and still renders when metadata resolution fails', async () => {
      const logger = mockLogger()
      const handler = createPreviewConsentHandler({
        trustedClients: [],
        resolveClientMetadata: () => Promise.reject(new Error('fetch failed')),
        getClientCss: () => null,
        logger,
      })!
      const res = mockRes()
      await handler(
        { query: { client_id: 'https://broken.example/client-metadata.json' } },
        res,
      )
      expect(logger.warn).toHaveBeenCalledOnce()
      const [ctx, msg] = logger.warn.mock.calls[0]
      expect(msg).toMatch(/Preview consent/i)
      expect(ctx).toMatchObject({
        clientId: 'https://broken.example/client-metadata.json',
      })
      // Still responds with valid HTML shell:
      expect(res.body).toMatch(/<!doctype html>/i)
    })

    it('ignores non-string client_id and falls back to fixture default', async () => {
      const resolveClientMetadata = vi.fn(() => Promise.resolve({}))
      const handler = createPreviewConsentHandler({
        trustedClients: [],
        resolveClientMetadata,
        getClientCss: () => null,
        logger: mockLogger(),
      })!
      const res = mockRes()
      await handler({ query: { client_id: ['array', 'value'] } }, res)
      // Default fixture client: no resolution attempted
      expect(resolveClientMetadata).not.toHaveBeenCalled()
      expect(res.body).toContain('preview.example/client-metadata.json')
    })

    it('HTML-escapes the client id in the <title>', async () => {
      const handler = createPreviewConsentHandler({
        trustedClients: [],
        resolveClientMetadata: () => Promise.resolve({}),
        getClientCss: () => null,
        logger: mockLogger(),
      })!
      const res = mockRes()
      await handler(
        {
          query: { client_id: 'https://x.example/<dangerous>tag</dangerous>' },
        },
        res,
      )
      // Title is HTML-escaped:
      expect(res.body).toContain(
        '<title>Consent preview — https://x.example/&lt;dangerous&gt;tag&lt;/dangerous&gt;</title>',
      )
      // Raw tag must not appear in the title context. It does appear
      // unescaped inside the JSON hydration string literal — that's fine
      // because the browser parses it as a JS string, not HTML — so we
      // only assert the title remains escaped, by checking no unescaped
      // `<dangerous>` precedes the hydration <script> block.
      const titleEnd = res.body!.indexOf('</title>')
      expect(res.body!.slice(0, titleEnd)).not.toContain('<dangerous>')
    })
  })
})

describe('renderPreviewIndex', () => {
  it('returns an HTML page listing the consent preview route', () => {
    const html = renderPreviewIndex()
    expect(html).toMatch(/<!DOCTYPE html>/i)
    expect(html).toContain('pds-core preview routes')
    expect(html).toContain('href="/preview/consent"')
    expect(html).toContain('PDS_OAUTH_TRUSTED_CLIENTS')
  })
})
