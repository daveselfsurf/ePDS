/**
 * Ensures every rendered `<head>` in the auth-service routes wires the
 * Certified favicon. The favicon tag is a static one-liner — rather than
 * stand up each render helper with its full `opts` shape, this test scans
 * the route source for every `<head>` block and asserts it contains the
 * expected `<link rel="icon">` reference. This catches future routes /
 * render helpers that forget the tag.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROUTES_DIR = path.join(__dirname, '..', 'routes')

const ROUTE_FILES = [
  'login-page.ts',
  'recovery.ts',
  'choose-handle.ts',
  'account-login.ts',
  'account-settings.ts',
]

const FAVICON_LINK =
  '<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">'

/**
 * Match every `<head>...</head>` block. `[\s\S]` lets the body span
 * newlines; the `?` makes the quantifier lazy so adjacent heads don't
 * merge.
 */
const HEAD_BLOCK = /<head\b[^>]*>[\s\S]*?<\/head>/g

describe('favicon wiring across auth-service route templates', () => {
  for (const file of ROUTE_FILES) {
    it(`${file}: every <head> block includes the favicon link`, () => {
      const source = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8')
      const heads = source.match(HEAD_BLOCK) ?? []
      expect(heads.length).toBeGreaterThan(0)
      for (const head of heads) {
        expect(head).toContain(FAVICON_LINK)
      }
    })
  }
})
