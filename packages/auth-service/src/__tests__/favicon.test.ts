/**
 * Ensures every rendered `<head>` in the auth-service routes wires both
 * the light- and dark-mode Certified favicons. The favicon tags are
 * static one-liners — rather than stand up each render helper with its
 * full `opts` shape, this test scans the route source for every `<head>`
 * block and asserts it contains both `<link rel="icon">` variants gated
 * by `prefers-color-scheme`. This catches future routes / render helpers
 * that forget the tags or wire only one of the two.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROUTES_DIR = path.join(__dirname, '..', 'routes')

const FAVICON_LIGHT =
  '<link rel="icon" href="/static/favicon.svg" media="(prefers-color-scheme: light)" type="image/svg+xml">'
const FAVICON_DARK =
  '<link rel="icon" href="/static/favicon-dark.svg" media="(prefers-color-scheme: dark)" type="image/svg+xml">'

/**
 * Match every `<head>...</head>` block. `[\s\S]` lets the body span
 * newlines; the `?` makes the quantifier lazy so adjacent heads don't
 * merge.
 */
const HEAD_BLOCK = /<head\b[^>]*>[\s\S]*?<\/head>/g

/**
 * Auto-discover every route file that renders at least one `<head>` block.
 * A hardcoded list silently misses new rendered pages; raw `readdirSync`
 * false-fails on route files that never render HTML (e.g. `complete.ts`).
 * Filtering by "contains a `<head>`" catches future renderers automatically
 * while excluding non-HTML routes.
 */
const routeFiles = fs
  .readdirSync(ROUTES_DIR)
  .filter((file) => file.endsWith('.ts'))
  .map((file) => ({
    file,
    heads:
      fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8').match(HEAD_BLOCK) ??
      [],
  }))
  .filter(({ heads }) => heads.length > 0)

describe('favicon wiring across auth-service route templates', () => {
  it('discovers at least one route that renders HTML', () => {
    expect(routeFiles.length).toBeGreaterThan(0)
  })

  for (const { file, heads } of routeFiles) {
    it(`${file}: every <head> block includes both favicon links`, () => {
      for (const head of heads) {
        expect(head).toContain(FAVICON_LIGHT)
        expect(head).toContain(FAVICON_DARK)
      }
    })
  }
})
