/**
 * "Clean exit" response helper used by every dead-end path in
 * auth-service that today renders a static "Session expired" page
 * with no recovery option. Two tiers, in priority order:
 *
 *   1. Redirect the user back to the OAuth client's `redirect_uri`
 *      with the RFC 6749 §4.1.2.1 error parameters. The client's own
 *      UI then surfaces a one-click retry. This is the right
 *      semantics whenever we have a `clientId` in scope.
 *
 *   2. When no `clientId` is in scope (the error fired before we
 *      stashed one on the auth_flow row, or the auth_flow row itself
 *      is gone), render a styled HTML page with a "Start over"
 *      button. The button targets the client's `client_uri` when
 *      available, or — as a last resort — does not appear at all
 *      and the user is left to navigate manually. We never strand
 *      the user without explanation.
 *
 * See `docs/design/par-expiry-and-clean-exits.md` for the audit of
 * which call sites use this helper and why.
 */
import type { Response } from 'express'
import { resolveClientMetadata, createLogger } from '@certified-app/shared'
import {
  buildClientErrorRedirect,
  type ClientErrorCode,
} from './redirect-to-client-error.js'
import { renderError } from './render-error.js'

const logger = createLogger('auth:clean-exit')

export interface CleanExitOpts {
  res: Response
  /**
   * The OAuth client this flow belongs to, if known. When present,
   * the helper attempts the RFC 6749 redirect path first.
   */
  clientId: string | null | undefined
  /** PDS issuer URL for the `iss` parameter on the redirect. */
  pdsUrl: string
  /**
   * Spec error code for the redirect path. `access_denied` for
   * user-paced timeouts (matches the upstream code), `server_error`
   * for unexpected internal failures.
   */
  code: ClientErrorCode
  /**
   * Human-readable copy intended for direct display. Used both as
   * `error_description` on the redirect path and as the body text on
   * the Start Over page.
   */
  description: string
  /** HTTP status when the Start Over fallback fires. Default 400. */
  fallbackStatus?: number
  /**
   * Original `state` parameter, if it survives the failure path.
   * Most cluster-A/B sites have lost it (it lived in the dead PAR);
   * pass it when available.
   */
  state?: string
}

/**
 * Emit a clean-exit response. Mutates `res` (sends the redirect or
 * the HTML page) and returns once the response is committed.
 */
export async function cleanExit(opts: CleanExitOpts): Promise<void> {
  const fallbackStatus = opts.fallbackStatus ?? 400

  // Cache-Control: no-store on every clean-exit path — the response
  // carries per-request error context and a cached copy is at best
  // misleading on a later attempt.
  opts.res.setHeader('Cache-Control', 'no-store')

  // Tier 1: redirect to the OAuth client.
  if (opts.clientId) {
    const target = await buildClientErrorRedirect({
      clientId: opts.clientId,
      pdsUrl: opts.pdsUrl,
      code: opts.code,
      description: opts.description,
      state: opts.state,
    })
    if (target) {
      opts.res.redirect(303, target)
      return
    }
  }

  // Tier 2: styled page with a Start Over link, when we can resolve
  // the client's home page.
  const startOverHref = opts.clientId
    ? await resolveClientHome(opts.clientId)
    : null

  opts.res
    .status(fallbackStatus)
    .type('html')
    .send(
      renderError(opts.description, {
        title: 'Sign-in session expired',
        startOverHref: startOverHref ?? undefined,
        startOverLabel: 'Return to sign in',
      }),
    )
}

/**
 * Best-effort lookup of the client's user-facing home / sign-in URL.
 * Prefers `client_uri` (an OAuth client metadata field intended for
 * exactly this purpose) and falls back to the client's origin.
 * Returns null when metadata cannot be resolved at all — the Start
 * Over button is then omitted and the page degrades to message-only.
 */
async function resolveClientHome(clientId: string): Promise<string | null> {
  try {
    const metadata = await resolveClientMetadata(clientId)
    if (metadata.client_uri) return metadata.client_uri
    // Fallback: derive an origin from the client_id URL itself. Most
    // atproto OAuth clients use a metadata URL on their own host, so
    // the origin is a reasonable Sign-In landing page.
    try {
      return new URL(clientId).origin
    } catch {
      return null
    }
  } catch (err) {
    logger.warn(
      { err, clientId },
      'cleanExit: client metadata lookup for Start Over failed',
    )
    return null
  }
}
