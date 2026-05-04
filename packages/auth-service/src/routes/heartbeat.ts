/**
 * GET /auth/ping
 *
 * Server-mediated heartbeat used by the OTP and recovery forms to slide
 * the upstream PAR (request_uri) inactivity timer while the user is on
 * the page. Without this, a user who reads their email for >5 minutes
 * (atproto's AUTHORIZATION_INACTIVITY_TIMEOUT) trips the dead-PAR path
 * downstream when they finally submit. See
 * `docs/design/par-expiry-and-clean-exits.md` for the broader context.
 *
 * The browser cannot call pds-core's /_internal/ping-request directly
 * (that endpoint requires EPDS_INTERNAL_SECRET, which never leaves the
 * server), so this route reads the user's `epds_auth_flow` cookie,
 * looks up the auth_flow row, and proxies the existing
 * `pingParRequest()` call server-side.
 *
 * Security boundary: the heartbeat does *not* extend OTP, auth_flow, or
 * any session — it only refreshes the PAR row's sliding `expiresAt`
 * field upstream. Bounded by the auth_flow's own 60-min TTL: once the
 * auth_flow row is gone, the ping returns `flow_expired` and the
 * browser stops pinging. No new tokens are issued.
 */
import { Router, type Request, type Response } from 'express'
import { createLogger } from '@certified-app/shared'
import type { AuthServiceContext } from '../context.js'
import { pingParRequest } from '../lib/ping-par-request.js'
import { requireInternalEnv } from '../lib/require-internal-env.js'

const logger = createLogger('auth:heartbeat')

const AUTH_FLOW_COOKIE = 'epds_auth_flow'

export type HeartbeatResponse =
  | { ok: true }
  | { ok: false; reason: 'no_cookie' | 'flow_expired' | 'par_expired' }

export function createHeartbeatRouter(ctx: AuthServiceContext): Router {
  const router = Router()
  const { pdsUrl, internalSecret } = requireInternalEnv()

  router.get('/auth/ping', async (req: Request, res: Response) => {
    // Cache-Control: no-store so an intermediary doesn't cache one
    // user's response and serve it to a different in-flight flow.
    res.setHeader('Cache-Control', 'no-store')

    const flowId = req.cookies[AUTH_FLOW_COOKIE] as string | undefined
    if (!flowId) {
      const body: HeartbeatResponse = { ok: false, reason: 'no_cookie' }
      res.status(200).json(body)
      return
    }

    const flow = ctx.db.getAuthFlow(flowId)
    if (!flow) {
      const body: HeartbeatResponse = { ok: false, reason: 'flow_expired' }
      res.status(200).json(body)
      return
    }

    const ping = await pingParRequest(flow.requestUri, pdsUrl, internalSecret)
    if (!ping.ok) {
      logger.debug(
        { status: ping.status, err: ping.err, flowId },
        'heartbeat: PAR ping failed',
      )
      const body: HeartbeatResponse = { ok: false, reason: 'par_expired' }
      res.status(200).json(body)
      return
    }

    const okBody: HeartbeatResponse = { ok: true }
    res.status(200).json(okBody)
  })

  return router
}
