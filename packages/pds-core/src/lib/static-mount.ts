/**
 * Mount the pds-core `/static/*` asset directory on an Express app.
 *
 * Extracted into a helper so it can be unit-tested. The callsite in
 * `index.ts` only runs in the real server start-up path and is therefore
 * not reachable from the vitest suite.
 */
import express, { type Application } from 'express'

/**
 * Mount `publicDir` at `/static`. Caller resolves the path (typically
 * `path.resolve(__dirname, '..', 'public')`) so the helper stays
 * agnostic to CJS/ESM callsite conventions.
 */
export function mountStaticAssets(app: Application, publicDir: string): void {
  app.use('/static', express.static(publicDir))
}
