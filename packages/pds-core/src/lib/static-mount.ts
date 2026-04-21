/**
 * Mount the pds-core `/static/*` asset directory on an Express app,
 * plus a `/favicon.ico` alias so browsers that auto-request the legacy
 * path on non-HTML responses (e.g. `/health`, XRPC JSON) still get an
 * icon. The alias serves the light-theme SVG — `prefers-color-scheme`
 * only works via `<link media=...>` tags in a real `<head>`, so the ico
 * fallback is intentionally single-variant.
 *
 * Extracted into a helper so it can be unit-tested. The callsite in
 * `index.ts` only runs in the real server start-up path and is therefore
 * not reachable from the vitest suite.
 */
import * as path from 'node:path'

import express, { type Application } from 'express'

/**
 * Mount `publicDir` at `/static` and alias `/favicon.ico` to
 * `publicDir/favicon.svg`. Caller resolves `publicDir` (typically
 * `path.resolve(__dirname, '..', 'public')`) so the helper stays
 * agnostic to CJS/ESM callsite conventions.
 */
export function mountStaticAssets(app: Application, publicDir: string): void {
  app.get('/favicon.ico', (_req, res) => {
    res.sendFile(path.join(publicDir, 'favicon.svg'))
  })
  app.use('/static', express.static(publicDir))
}
