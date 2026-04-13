/**
 * Headless OTP endpoints for registered API clients.
 *
 * These endpoints allow a client app to send and verify OTP codes without
 * the OAuth redirect flow. The client's own UI collects the email and code,
 * and its backend proxies to these endpoints server-to-server.
 *
 * Both endpoints are authenticated via the x-api-key header, which maps to
 * a registered client in the api_clients table. Each client has per-client
 * rate limits, optional origin restrictions, and a can_signup permission.
 *
 * POST /_internal/otp/send   — generate + email an OTP code
 * POST /_internal/otp/verify — verify code, return AT Proto session tokens
 */
import { Router, type Request, type Response } from 'express'
import { randomBytes } from 'node:crypto'
import { createLogger } from '@certified-app/shared'
import type { AuthServiceContext } from '../context.js'
import type { BetterAuthInstance } from '../better-auth.js'
import { getDidByEmail } from '../lib/get-did-by-email.js'
import { ensurePdsUrl } from '../lib/pds-url.js'
import { setHeadlessClientId, clearHeadlessClientId } from '../better-auth.js'
import {
  authenticateApiKey,
  checkAllowedOrigin,
  checkApiClientRateLimit,
} from '../lib/headless-auth.js'

const logger = createLogger('auth:headless-otp')

function adminAuth(): string {
  const password = process.env.PDS_ADMIN_PASSWORD
  if (!password) throw new Error('PDS_ADMIN_PASSWORD is not configured')
  return `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`
}

function getPdsUrl(): string {
  return ensurePdsUrl(
    process.env.PDS_INTERNAL_URL,
    `https://${process.env.PDS_HOSTNAME ?? 'localhost'}`,
  )
}

function getHandleDomain(): string {
  return process.env.PDS_HOSTNAME ?? 'localhost'
}

export function createHeadlessOtpRouter(
  ctx: AuthServiceContext,
  auth: BetterAuthInstance,
): Router {
  const router = Router()

  // ─── POST /_internal/otp/send ───────────────────────────────────────
  router.post('/_internal/otp/send', async (req: Request, res: Response) => {
    const apiClient = authenticateApiKey(req, ctx.db)
    if (!apiClient) {
      logger.warn({ ip: req.ip }, 'Headless OTP send: invalid API key')
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    if (!checkAllowedOrigin(apiClient.allowedOrigins, req.headers.origin)) {
      res.status(403).json({ error: 'OriginNotAllowed' })
      return
    }

    if (
      !checkApiClientRateLimit(ctx.db, apiClient.id, apiClient.rateLimitPerHour)
    ) {
      res.status(429).json({ error: 'RateLimitExceeded' })
      return
    }

    const email = ((req.body?.email as string) || '').trim().toLowerCase()
    const purpose = (req.body?.purpose as string) || ''
    const clientId =
      (req.body?.clientId as string) || apiClient.clientId || undefined

    if (!email || !purpose) {
      res.status(400).json({ error: 'email and purpose are required' })
      return
    }

    if (purpose !== 'login' && purpose !== 'signup') {
      res.status(400).json({ error: 'purpose must be login or signup' })
      return
    }

    if (purpose === 'signup' && !apiClient.canSignup) {
      res.status(403).json({ error: 'SignupNotAllowed' })
      return
    }

    const pdsUrl = getPdsUrl()
    const internalSecret = process.env.EPDS_INTERNAL_SECRET ?? ''

    if (purpose === 'login') {
      // Check if account exists — anti-enumeration: return success either way
      const did = await getDidByEmail(email, pdsUrl, internalSecret)
      if (!did) {
        // No account — return success but don't send email
        logger.info(
          { email },
          'Headless OTP send: no account found (anti-enumeration)',
        )
        res.json({ success: true })
        return
      }
    }

    if (purpose === 'signup') {
      // Anti-enumeration: return success whether or not an account exists.
      // The actual conflict will be caught at verify-time (createAccount fails).
      const did = await getDidByEmail(email, pdsUrl, internalSecret)
      if (did) {
        logger.info(
          { email },
          'Headless OTP send: email already registered (anti-enumeration)',
        )
        res.json({ success: true })
        return
      }
    }

    ctx.db.recordApiClientUsage(apiClient.id, 'otp_send')
    ctx.db.updateApiClientLastUsed(apiClient.id)

    // Store clientId for branding in the sendVerificationOTP callback
    if (clientId) {
      setHeadlessClientId(email, clientId)
    }

    try {
      await auth.api.sendVerificationOTP({
        body: { email, type: 'sign-in' },
      })
      res.json({ success: true })
    } catch (err) {
      logger.error({ err, email }, 'Failed to send OTP')
      // Anti-enumeration: return success even on failure
      res.json({ success: true })
    } finally {
      if (clientId) {
        clearHeadlessClientId(email)
      }
    }
  })

  // ─── POST /_internal/otp/verify ─────────────────────────────────────
  router.post('/_internal/otp/verify', async (req: Request, res: Response) => {
    const apiClient = authenticateApiKey(req, ctx.db)
    if (!apiClient) {
      logger.warn({ ip: req.ip }, 'Headless OTP verify: invalid API key')
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    if (!checkAllowedOrigin(apiClient.allowedOrigins, req.headers.origin)) {
      res.status(403).json({ error: 'OriginNotAllowed' })
      return
    }

    if (
      !checkApiClientRateLimit(ctx.db, apiClient.id, apiClient.rateLimitPerHour)
    ) {
      res.status(429).json({ error: 'RateLimitExceeded' })
      return
    }

    const email = ((req.body?.email as string) || '').trim().toLowerCase()
    const otp = ((req.body?.otp as string) || '').trim()
    const purpose = (req.body?.purpose as string) || ''
    const handle = ((req.body?.handle as string) || '').trim().toLowerCase()

    if (!email || !otp || !purpose) {
      res.status(400).json({ error: 'email, otp, and purpose are required' })
      return
    }

    if (purpose === 'signup' && !handle) {
      res.status(400).json({ error: 'handle is required for signup' })
      return
    }

    if (purpose === 'signup' && !apiClient.canSignup) {
      res.status(403).json({ error: 'SignupNotAllowed' })
      return
    }

    // Verify OTP via Better Auth
    try {
      await auth.api.signInEmailOTP({
        body: { email, otp: otp.toUpperCase() },
      })
    } catch (err) {
      logger.warn({ err, email }, 'Headless OTP verification failed')
      res.status(400).json({ error: 'InvalidCode' })
      return
    }

    ctx.db.recordApiClientUsage(apiClient.id, 'otp_verify')
    ctx.db.updateApiClientLastUsed(apiClient.id)

    const pdsUrl = getPdsUrl()
    const handleDomain = getHandleDomain()

    try {
      if (purpose === 'login') {
        const result = await handleLogin(email, pdsUrl)
        res.json(result)
      } else if (purpose === 'signup') {
        const result = await handleSignup(email, handle, handleDomain, pdsUrl)
        res.status(201).json(result)
      } else {
        res.status(400).json({ error: 'Invalid purpose' })
      }
    } catch (err) {
      logger.error({ err, email, purpose }, 'Headless OTP post-verify failed')
      const message = err instanceof Error ? err.message : 'Verification failed'
      res.status(500).json({ error: message })
    }
  })

  return router
}

// ─── Login: ephemeral password → session tokens ────────────────────────
async function handleLogin(
  email: string,
  pdsUrl: string,
): Promise<{
  did: string
  handle: string
  accessJwt: string
  refreshJwt: string
}> {
  const internalSecret = process.env.EPDS_INTERNAL_SECRET ?? ''
  const did = await getDidByEmail(email, pdsUrl, internalSecret)
  if (!did) {
    throw new Error('No account found with this email address')
  }

  // Ephemeral password: set → use → discard
  const ephemeralPassword = randomBytes(32).toString('hex')

  // Reset password via admin API
  const resetRes = await fetch(
    `${pdsUrl}/xrpc/com.atproto.admin.updateAccountPassword`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: adminAuth(),
      },
      body: JSON.stringify({ did, password: ephemeralPassword }),
    },
  )
  if (!resetRes.ok) {
    const error = await resetRes.text()
    logger.error(
      { did, status: resetRes.status, error },
      'Failed to reset password',
    )
    throw new Error('Failed to authenticate account')
  }

  // Create session with ephemeral password
  const sessionRes = await fetch(
    `${pdsUrl}/xrpc/com.atproto.server.createSession`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email, password: ephemeralPassword }),
    },
  )
  if (!sessionRes.ok) {
    const error = await sessionRes.text()
    logger.error(
      { did, status: sessionRes.status, error },
      'Failed to create session',
    )
    throw new Error('Login failed')
  }

  const session = (await sessionRes.json()) as {
    did: string
    handle: string
    accessJwt: string
    refreshJwt: string
  }

  return {
    did: session.did,
    handle: session.handle,
    accessJwt: session.accessJwt,
    refreshJwt: session.refreshJwt,
  }
}

// ─── Signup: invite → account → session tokens ─────────────────────────
async function handleSignup(
  email: string,
  handle: string,
  handleDomain: string,
  pdsUrl: string,
): Promise<{
  did: string
  handle: string
  accessJwt: string
  refreshJwt: string
  created: boolean
}> {
  const ephemeralPassword = randomBytes(32).toString('hex')
  const fullHandle = `${handle}.${handleDomain}`

  // Mint invite code
  const inviteRes = await fetch(
    `${pdsUrl}/xrpc/com.atproto.server.createInviteCode`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: adminAuth(),
      },
      body: JSON.stringify({ useCount: 1 }),
    },
  )
  if (!inviteRes.ok) {
    const error = await inviteRes.text()
    logger.error(
      { status: inviteRes.status, error },
      'Failed to mint invite code',
    )
    throw new Error('Account creation temporarily unavailable')
  }
  const { code: inviteCode } = (await inviteRes.json()) as { code: string }

  // Create account
  const createRes = await fetch(
    `${pdsUrl}/xrpc/com.atproto.server.createAccount`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        handle: fullHandle,
        password: ephemeralPassword,
        inviteCode,
      }),
    },
  )
  if (!createRes.ok) {
    const errorData = (await createRes.json()) as {
      error?: string
      message?: string
    }
    const errorCode = errorData.error || ''
    const errorMessages: Record<string, string> = {
      HandleNotAvailable: 'This handle is already taken',
      InvalidHandle: 'Invalid handle format',
      EmailNotAvailable: 'An account with this email already exists',
    }
    throw new Error(
      errorMessages[errorCode] ||
        errorData.message ||
        'Account creation failed',
    )
  }

  const session = (await createRes.json()) as {
    did: string
    handle: string
    accessJwt: string
    refreshJwt: string
  }

  return {
    did: session.did,
    handle: session.handle,
    accessJwt: session.accessJwt,
    refreshJwt: session.refreshJwt,
    created: true,
  }
}
