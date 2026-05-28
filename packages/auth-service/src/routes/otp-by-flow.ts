/**
 * Flow-keyed OTP endpoints for the OAuth login page's HANDLE path.
 *
 * When a user starts an OAuth sign-in with a public handle/DID (rather than
 * typing their email), the resolved account email must never reach the
 * browser — otherwise anyone who knows the public handle could read it from
 * the page source. These endpoints let the browser drive OTP send/verify
 * using only the `epds_auth_flow` cookie (which carries the flowId); the
 * server looks the email up from the auth_flow row and calls better-auth.
 *
 * POST /auth/otp/send-by-flow   — send the OTP to the flow's stored email
 * POST /auth/otp/verify-by-flow — verify the code, set the session cookie
 *
 * These are browser (same-origin) routes, mounted AFTER CSRF middleware.
 */
import { Router, type Request, type Response } from 'express'
import { createLogger } from '@certified-app/shared'
import type { AuthServiceContext } from '../context.js'

const logger = createLogger('auth:otp-by-flow')

const AUTH_FLOW_COOKIE = 'epds_auth_flow'

export function createOtpByFlowRouter(
  ctx: AuthServiceContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- better-auth instance has no exported type; asResponse:true needs the loose type (see recovery.ts)
  auth: any,
): Router {
  const router = Router()

  // Resolve the flow's stored email from the epds_auth_flow cookie. Returns
  // null when the cookie is missing, the flow is expired/unknown, or no email
  // was stored on it.
  function emailForRequest(req: Request): string | null {
    const flowId = req.cookies[AUTH_FLOW_COOKIE] as string | undefined
    if (!flowId) return null
    const flow = ctx.db.getAuthFlow(flowId)
    return flow?.email ?? null
  }

  // ─── POST /auth/otp/send-by-flow ────────────────────────────────────
  router.post(
    '/auth/otp/send-by-flow',
    async (_req: Request, res: Response) => {
      const email = emailForRequest(_req)

      // Anti-enumeration: always report success. If the flow has no email
      // (expired cookie, or somehow reached here without a resolved handle),
      // there is simply nothing to send.
      if (!email) {
        logger.info('send-by-flow: no flow email; returning ok (no send)')
        res.json({ ok: true })
        return
      }

      try {
        await auth.api.sendVerificationOTP({
          body: { email, type: 'sign-in' },
        })
      } catch (err) {
        logger.error({ err }, 'send-by-flow: failed to send OTP')
        // Anti-enumeration: do not surface whether the address exists.
      }
      res.json({ ok: true })
    },
  )

  // ─── POST /auth/otp/verify-by-flow ──────────────────────────────────
  router.post(
    '/auth/otp/verify-by-flow',
    async (req: Request, res: Response) => {
      const otp = ((req.body?.otp as string) || '').trim()
      if (!otp) {
        res.status(400).json({ error: 'otp is required' })
        return
      }

      const email = emailForRequest(req)
      if (!email) {
        // Flow/cookie expired or no email — fail gracefully, no 500.
        res.status(400).json({ error: 'SessionExpired' })
        return
      }

      try {
        const response = await auth.api.signInEmailOTP({
          body: { email, otp: otp.toUpperCase() },
          asResponse: true,
        })

        // Forward better-auth's session Set-Cookie to the browser so the
        // subsequent /auth/complete navigation is authenticated. (Mirrors
        // the pattern in recovery.ts verify.)
        if (
          response instanceof Response ||
          (response && typeof response.headers?.get === 'function')
        ) {
          const setCookie = response.headers.get('set-cookie')
          if (setCookie) {
            res.setHeader('Set-Cookie', setCookie)
          }
        }
      } catch (err) {
        logger.warn({ err }, 'verify-by-flow: OTP verification failed')
        res.status(400).json({ error: 'InvalidCode' })
        return
      }

      res.json({ ok: true })
    },
  )

  return router
}
