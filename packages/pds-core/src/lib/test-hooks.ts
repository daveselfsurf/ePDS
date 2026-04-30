/**
 * E2E test-only hooks. Mounted only when EPDS_TEST_HOOKS=1 and refused
 * outright when NODE_ENV=production. Mirrors auth-service's /_internal/test/*
 * pattern: narrow UPDATEs that backdate a single timestamp to reproduce
 * time-dependent behaviour without waiting out the wall-clock TTL.
 *
 * Currently exposes:
 *   POST /_internal/test/expire-device-account
 *     Body: {did, deviceId?}
 *     Backdates `account_device.updatedAt` 8 days into the past for the
 *     matching row(s). Used by the e2e suite to age bindings past
 *     upstream's authenticationMaxAge (7d) so checkLoginRequired returns
 *     true for the targeted binding(s).
 */
import express, { type Application } from 'express'
import type { PDS } from '@atproto/pds'
import { verifyInternalSecret } from '@certified-app/shared'
import type { Logger } from 'pino'

export function installTestHooks(opts: {
  pds: PDS
  app: Application
  logger: Pick<Logger, 'warn' | 'error'>
}): void {
  const { pds, app, logger } = opts
  if (process.env.EPDS_TEST_HOOKS !== '1') return
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'EPDS_TEST_HOOKS=1 is set but NODE_ENV=production — refusing to mount test-only endpoints',
    )
  }
  logger.warn(
    'Test hooks ENABLED — /_internal/test/* routes are live (EPDS_TEST_HOOKS=1)',
  )

  app.post(
    '/_internal/test/expire-device-account',
    express.json(),
    async (req, res) => {
      if (!verifyInternalSecret(req.headers['x-internal-secret'])) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
      const did = ((req.body?.did as string) || '').trim()
      const deviceId =
        typeof req.body?.deviceId === 'string'
          ? req.body.deviceId.trim()
          : undefined
      if (!did) {
        res.status(400).json({ error: 'Missing did' })
        return
      }
      // 8 days ago — comfortably past upstream's 7-day authenticationMaxAge
      // so checkLoginRequired returns true on every backdated row.
      const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
      try {
        // Reuse the PDS accountManager's own Kysely instance — same handle
        // PDS uses for upsertDeviceAccount, so there are no two-connection
        // WAL-visibility surprises.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- account_device shape not exported by @atproto/pds
        const db = pds.ctx.accountManager.db.db as any
        let q = db
          .updateTable('account_device')
          .set({ updatedAt: past })
          .where('did', '=', did)
        if (deviceId) {
          q = q.where('deviceId', '=', deviceId)
        }
        const result = await q.executeTakeFirst()
        const updated = Number(result?.numUpdatedRows ?? 0)
        logger.warn(
          { did, deviceId, updated, past },
          'Backdated account_device.updatedAt',
        )
        res.json({ updated })
      } catch (err) {
        logger.error(
          { err, did, deviceId },
          'Failed to backdate account_device.updatedAt',
        )
        res.status(500).json({ error: 'Internal server error' })
      }
    },
  )
}
