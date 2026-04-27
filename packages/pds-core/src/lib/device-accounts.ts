/**
 * Device-bound account lookup shared between welcome-page-guard and the
 * /_internal/device-accounts endpoint.
 *
 * Validates a (dev-id, ses-id) cookie pair against the live device row,
 * then asks `accountManager.listDeviceAccounts` for the bindings. Returns
 * the bound account emails (lowercased) or null when validation fails.
 *
 * "Validation fails" means: either id is syntactically malformed, the
 * device row is missing, the device row's active sessionId does not match
 * the supplied ses-id, or any underlying call throws. In every miss we
 * return null — never partial data — so callers don't accidentally trust
 * a stale half-state.
 */
import type { DeviceId, OAuthProvider } from '@atproto/oauth-provider'
import {
  DEVICE_ID_BYTES_LENGTH,
  DEVICE_ID_PREFIX,
  SESSION_ID_BYTES_LENGTH,
  SESSION_ID_PREFIX,
} from '@atproto/oauth-provider'
import type { Logger } from 'pino'

const DEVICE_ID_RE = new RegExp(
  `^${DEVICE_ID_PREFIX}[0-9a-f]{${DEVICE_ID_BYTES_LENGTH * 2}}$`,
)
const SESSION_ID_RE = new RegExp(
  `^${SESSION_ID_PREFIX}[0-9a-f]{${SESSION_ID_BYTES_LENGTH * 2}}$`,
)

/** See welcome-page-guard.ts — same minimal contract; duplicated here so
 *  this module doesn't depend on the guard. */
type DeviceStoreLike = {
  readDevice: (deviceId: DeviceId) => Promise<{ sessionId: string } | null>
}

export type LoadDeviceAccountEmailsOpts = {
  provider: OAuthProvider
  deviceId: string
  sessionId: string
  logger?: Partial<Pick<Logger, 'error' | 'debug'>>
}

/** Validate the cookie pair and return the lowercased emails of every
 *  account bound to the device, or `null` if the pair is malformed,
 *  unknown, or its ses-id doesn't match the device row.
 *
 *  Lowercases emails to mirror `/_internal/account-by-email`'s normalised
 *  lookup so callers can compare a resolved login_hint email directly. */
export async function loadDeviceAccountEmails(
  opts: LoadDeviceAccountEmailsOpts,
): Promise<string[] | null> {
  const { provider, deviceId, sessionId, logger } = opts
  if (!DEVICE_ID_RE.test(deviceId)) return null
  if (!SESSION_ID_RE.test(sessionId)) return null

  const deviceStore = (
    provider.deviceManager as unknown as { store: DeviceStoreLike }
  ).store
  try {
    const data = await deviceStore.readDevice(deviceId as DeviceId)
    if (!data || data.sessionId !== sessionId) return null
  } catch (err) {
    logger?.error?.({ err, deviceId }, 'device-accounts: readDevice failed')
    return null
  }

  try {
    const bindings = await provider.accountManager.listDeviceAccounts(
      deviceId as DeviceId,
    )
    return bindings
      .map((b) => b.account.email)
      .filter((e): e is string => typeof e === 'string' && e.length > 0)
      .map((e) => e.toLowerCase())
  } catch (err) {
    logger?.error?.(
      { err, deviceId },
      'device-accounts: listDeviceAccounts failed',
    )
    return null
  }
}
