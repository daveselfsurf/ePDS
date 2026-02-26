/**
 * Resolve an OAuth login_hint to an email address.
 *
 * Per the AT Protocol OAuth spec, the login_hint may be an email, a handle
 * (e.g. "user.epds1.test.certified.app"), or a DID (e.g. "did:plc:abc123").
 * Third-party apps typically pass the handle or DID. The auth service needs
 * an email to proceed with OTP, so this helper calls pds-core's internal
 * API to resolve non-email identifiers.
 *
 * Returns the email if the hint is already an email or if resolution
 * succeeds; returns null if the hint cannot be resolved.
 */
import { createLogger } from '@certified-app/shared'

const logger = createLogger('auth:resolve-login-hint')

const RESOLVE_TIMEOUT_MS = 3000

/**
 * Determine whether a login_hint is an email (contains '@'), a handle,
 * or a DID, and resolve it to the account's email address.
 */
export async function resolveLoginHint(
  loginHint: string,
  pdsInternalUrl: string,
  internalSecret: string,
): Promise<string | null> {
  if (!loginHint) return null

  // Already an email — use it directly
  if (loginHint.includes('@')) {
    return loginHint
  }

  // Handle or DID — resolve via pds-core internal API.
  // The PDS accountManager.getAccount() accepts both handles and DIDs.
  try {
    const url = `${pdsInternalUrl}/_internal/account-by-handle?handle=${encodeURIComponent(loginHint)}`
    const res = await fetch(url, {
      headers: { 'x-internal-secret': internalSecret },
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    })

    if (!res.ok) {
      logger.warn(
        { status: res.status, loginHint },
        'Failed to resolve login_hint via PDS internal API',
      )
      return null
    }

    const data = (await res.json()) as { email: string | null }
    if (data.email) {
      logger.debug(
        {
          loginHint,
          email: data.email.replace(/(.{2})[^@]*(@.*)/, '$1***$2'),
        },
        'Resolved login_hint to email',
      )
      return data.email
    }

    logger.debug({ loginHint }, 'login_hint resolved but no email found')
    return null
  } catch (err) {
    logger.warn({ err, loginHint }, 'Error resolving login_hint')
    return null
  }
}

/**
 * Retrieve the login_hint stored in a PAR request on pds-core.
 *
 * Third-party apps put the handle/DID in the PAR body but don't duplicate
 * it on the authorization redirect URL. This fetches it from pds-core's
 * /_internal/par-login-hint endpoint.
 *
 * Returns the login_hint string if found, or null on any error.
 */
export async function fetchParLoginHint(
  pdsInternalUrl: string,
  requestUri: string,
  internalSecret: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${pdsInternalUrl}/_internal/par-login-hint?request_uri=${encodeURIComponent(requestUri)}`,
      {
        headers: { 'x-internal-secret': internalSecret },
        signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
      },
    )
    if (!res.ok) {
      return null
    }
    const data = (await res.json()) as { login_hint: string | null }
    if (data.login_hint) {
      logger.debug(
        { loginHint: data.login_hint },
        'Retrieved login_hint from stored PAR request',
      )
      return data.login_hint
    }
    return null
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch login_hint from PAR request')
    return null
  }
}
