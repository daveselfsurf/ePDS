/**
 * Route-level coverage for the prompt=login branch of GET /oauth/authorize.
 *
 * GitHub issue #138: pds-core's "Another account" rebind navigates back to
 * auth-service with the original `login_hint` preserved AND `prompt=login`
 * appended. The login-page handler must:
 *
 *  1. Render the email step (not the OTP step) regardless of the hint.
 *  2. Leave the `#email` input empty (no pre-fill from the previous account).
 *  3. Skip the three internal-API round trips that would normally resolve
 *     the hint (`fetchParLoginHint`, `resolveLoginHint`,
 *     `fetchDeviceAccountEmails`) — none of their results are used on this
 *     path, so calling them is pure overhead.
 *
 * Mirrors the e2e scenario at
 * `features/session-reuse-bugs.feature:148`. The e2e test catches a
 * regression of (1) and (2); this test pins (3) — a regression that
 * re-introduced the network calls would silently revert the optimisation
 * without any user-visible effect, so e2e wouldn't notice.
 *
 * Lives in its own file because the `vi.mock` calls below replace the
 * shared resolver modules wholesale, and we don't want that bleed into the
 * existing unit tests in login-page.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { AddressInfo } from 'node:net'
import { _seedClientMetadataCacheForTest } from '@certified-app/shared'
import { csrfProtection } from '../middleware/csrf.js'
import { createLoginPageRouter } from '../routes/login-page.js'
import { AuthServiceContext, type AuthServiceConfig } from '../context.js'

// Hoisted spies — `vi.mock` runs before module imports, so the mock factory
// must capture them via `vi.hoisted` rather than referencing top-level
// `const`s that haven't been initialised yet.
const mocks = vi.hoisted(() => ({
  fetchParLoginHint: vi.fn(),
  resolveLoginHint: vi.fn(),
  fetchDeviceAccountEmails: vi.fn(),
}))

vi.mock('../lib/resolve-login-hint.js', () => ({
  fetchParLoginHint: mocks.fetchParLoginHint,
  resolveLoginHint: mocks.resolveLoginHint,
}))

vi.mock('../lib/fetch-device-accounts.js', () => ({
  fetchDeviceAccountEmails: mocks.fetchDeviceAccountEmails,
}))

function makeConfig(dbPath: string): AuthServiceConfig {
  return {
    hostname: 'auth.test.local',
    port: 0,
    sessionSecret: 'test-session-secret',
    csrfSecret: 'test-csrf-secret',
    epdsCallbackSecret: 'test-callback-secret',
    pdsHostname: 'test.local',
    pdsPublicUrl: 'https://test.local',
    email: {
      provider: 'smtp',
      smtpHost: 'localhost',
      smtpPort: 1025,
      from: 'noreply@test.local',
      fromName: 'ePDS Test',
    },
    dbLocation: dbPath,
    otpLength: 6,
    otpCharset: 'numeric',
    trustedClients: [],
  }
}

async function startApp(ctx: AuthServiceContext): Promise<{
  baseUrl: string
  close: () => Promise<void>
}> {
  const app = express()
  // Silence sonar's "framework version disclosure" hotspot that fires
  // on any vanilla express() instance. This is an in-process test
  // server bound to 127.0.0.1 on an ephemeral port — the header is
  // only visible to the test runner — but disabling it keeps the
  // signal clean.
  app.disable('x-powered-by')
  app.use(cookieParser())
  app.use(csrfProtection(ctx.config.csrfSecret))
  app.use(createLoginPageRouter(ctx))
  const server = app.listen(0)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.once('listening', () => {
      resolve()
    })
  })
  server.unref()
  const port = (server.address() as AddressInfo).port
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      }),
  }
}

describe('GET /oauth/authorize prompt=login handling (issue #138)', () => {
  let dbPath: string
  let ctx: AuthServiceContext
  let app: { baseUrl: string; close: () => Promise<void> }

  beforeEach(async () => {
    dbPath = path.join(
      os.tmpdir(),
      `prompt-login-${Date.now()}-${randomBytes(4).toString('hex')}.db`,
    )
    // Avoid an outbound fetch when the handler resolves client metadata.
    _seedClientMetadataCacheForTest('https://app.example.com', {
      client_name: 'Test App',
    })
    // AuthServiceContext opens its own EpdsDb against config.dbLocation;
    // we use ctx.db throughout (rather than constructing a parallel
    // instance and overwriting) so there's exactly one open SQLite handle
    // per test — `ctx.destroy()` in afterEach closes it cleanly and
    // releases the WAL/SHM companion files for the unlink to remove.
    ctx = new AuthServiceContext(makeConfig(dbPath))
    app = await startApp(ctx)
    mocks.fetchParLoginHint.mockReset()
    mocks.resolveLoginHint.mockReset()
    mocks.fetchDeviceAccountEmails.mockReset()
  })

  afterEach(async () => {
    await app.close()
    ctx.destroy()
    // Best-effort cleanup of the temp DB and its WAL/SHM companions.
    // SQLite in WAL mode writes alongside the main file; rmSync(force)
    // tolerates the missing companions when WAL was checkpointed before
    // close, and avoids the empty try/catch antipattern.
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(dbPath + suffix, { force: true })
    }
  })

  it('renders the email step with empty input on prompt=login + login_hint', async () => {
    // Even if a stale hint resolution were to slip through, force its
    // result to be a non-empty email so a regression that ignored
    // forceLogin would be obviously visible as a pre-filled box.
    mocks.fetchParLoginHint.mockResolvedValue('previous@example.com')
    mocks.resolveLoginHint.mockResolvedValue('previous@example.com')

    const url =
      app.baseUrl +
      '/oauth/authorize?request_uri=urn:ietf:params:oauth:request_uri:promptlogin' +
      '&client_id=' +
      encodeURIComponent('https://app.example.com') +
      '&login_hint=previous%40example.com' +
      '&prompt=login'
    const res = await fetch(url)
    expect(res.status).toBe(200)
    const html = await res.text()

    // (1) Email step is the rendered step, not the OTP step.
    expect(html).toMatch(/<div id="step-email" class="step-email">/)
    expect(html).not.toMatch(/class="step-otp active"/)

    // (2) Email input is empty (no pre-fill from the previous account).
    expect(html).toMatch(/<input type="email" id="email"[^>]*value=""[^>]*>/)
  })

  it('skips internal-API round trips when prompt=login is present', async () => {
    mocks.fetchParLoginHint.mockResolvedValue('previous@example.com')
    mocks.resolveLoginHint.mockResolvedValue('previous@example.com')
    // Make the assertion meaningful for fetchDeviceAccountEmails by sending
    // a dev-id/ses-id cookie pair: the handler only fetches device-bound
    // emails when BOTH a cookie pair is present AND `resolvedEmail` is
    // truthy. Without the cookie pair, the assertion would pass trivially
    // even if a regression reintroduced hint resolution.
    const url =
      app.baseUrl +
      '/oauth/authorize?request_uri=urn:ietf:params:oauth:request_uri:promptloginskip' +
      '&login_hint=previous%40example.com' +
      '&prompt=login'
    const res = await fetch(url, {
      headers: {
        cookie:
          'dev-id=dev-test-skip-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; ses-id=ses-test-skip-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    })
    expect(res.status).toBe(200)

    // The hint resolution chain must be untouched — its result is unused
    // on the prompt=login path AND shouldReuseSession bypasses the hint
    // check, so calling these is pure overhead on the PDS internal API.
    // With cookies present, a regression that left fetchDeviceAccountEmails
    // unguarded by forceLogin would call it; this assertion catches that.
    expect(mocks.fetchParLoginHint).not.toHaveBeenCalled()
    expect(mocks.resolveLoginHint).not.toHaveBeenCalled()
    expect(mocks.fetchDeviceAccountEmails).not.toHaveBeenCalled()
  })

  it('still resolves login_hint when prompt=login is absent (regression guard)', async () => {
    // Without prompt=login, the hint must still be resolved so the OTP
    // step can pre-fill the email — the optimisation only applies to the
    // forced-reauth path.
    mocks.resolveLoginHint.mockResolvedValue('user@example.com')

    const url =
      app.baseUrl +
      '/oauth/authorize?request_uri=urn:ietf:params:oauth:request_uri:nopromptlogin' +
      '&login_hint=user%40example.com'
    const res = await fetch(url)
    expect(res.status).toBe(200)
    const html = await res.text()

    expect(mocks.resolveLoginHint).toHaveBeenCalledWith(
      'user@example.com',
      expect.any(String),
      expect.any(String),
    )
    // OTP step is the active step (hasLoginHint true, !forceLogin).
    expect(html).toMatch(/class="step-otp active"/)
  })
})
