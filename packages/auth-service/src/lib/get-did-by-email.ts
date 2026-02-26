/**
 * Look up a DID for an email address via the PDS internal endpoint.
 *
 * Used by multiple routes to determine whether a PDS account already
 * exists for a given email (sign-up vs. login distinction, consent
 * checks, account settings).
 *
 * Returns the DID string if found, or null on not-found / error.
 */

import { createLogger } from '@certified-app/shared'

const logger = createLogger('auth:get-did-by-email')

export async function getDidByEmail(
  email: string,
  pdsUrl: string,
  internalSecret: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${pdsUrl}/_internal/account-by-email?email=${encodeURIComponent(email)}`,
      {
        headers: { 'x-internal-secret': internalSecret },
        signal: AbortSignal.timeout(3000),
      },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { did: string | null }
    return data.did
  } catch (err) {
    logger.warn({ err, email }, 'Failed to look up DID by email from PDS')
    return null
  }
}
