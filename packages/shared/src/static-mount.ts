/**
 * Mount a `/static/*` asset directory on an Express app, plus a
 * `/favicon.ico` alias so browsers that auto-request the legacy path on
 * non-HTML responses (e.g. `/health`, XRPC JSON) still get an icon.
 *
 * The alias serves `${publicDir}/favicon.svg` (the light-theme variant)
 * — `prefers-color-scheme` only works via `<link media=...>` tags in a
 * real `<head>`, so the ico fallback is intentionally single-variant.
 *
 * Callers pass an already-resolved `publicDir` so this helper stays
 * agnostic to CJS/ESM callsite conventions (auth-service is ESM,
 * pds-core is CJS).
 */
import * as path from 'node:path'

import express, { type Application } from 'express'

export function mountStaticAssets(app: Application, publicDir: string): void {
  app.get('/favicon.ico', (_req, res) => {
    res.sendFile(path.join(publicDir, 'favicon.svg'))
  })
  app.use('/static', express.static(publicDir))
}
