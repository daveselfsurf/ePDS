/**
 * Step definitions for consent-screen.feature.
 *
 * TODO: The @manual "client branding" scenario is not automated yet —
 * it depends on custom CSS injection being wired into the consent route
 * (renderConsent() needs to accept and apply clientBrandingCss from the
 * client metadata).
 */

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import type { EpdsWorld } from '../support/world.js'
import { testEnv } from '../support/env.js'
import {
  getPage,
  resetBrowserContext,
  assertDemoClientSession,
} from '../support/utils.js'
import {
  createAccountViaOAuth,
  startSignUpAwaitingConsent,
} from '../support/flows.js'
import { sharedBrowser } from '../support/hooks.js'
import { waitForEmail, extractOtp, clearMailpit } from '../support/mailpit.js'

function requireUntrustedDemoUrl(): string {
  const url = testEnv.demoUntrustedUrl
  if (!url) {
    throw new Error(
      'E2E_DEMO_UNTRUSTED_URL is not set — required by consent-screen scenarios ' +
        'that exercise the trusted-vs-untrusted client distinction. Set it in ' +
        'e2e/.env (locally) or in the GitHub Actions workflow (CI).',
    )
  }
  return url
}

// Note: When('the user clicks {string}') lives in common.steps.ts — it is a
// generic UI interaction step used here for "Authorize" and "Deny access" buttons.

// Exact scope set requested by both demo clients (trusted and untrusted).
// Sourced from packages/demo/src/app/client-metadata.json/route.ts — if the
// demo clients ever change which scopes they request, update this list in
// lock-step. Order is not significant: the assertion sorts both sides.
const DEMO_CLIENT_REQUESTED_SCOPES = ['atproto', 'transition:generic']

Then('a consent screen is displayed', async function (this: EpdsWorld) {
  const page = getPage(this)

  // Assert the Authorize button is rendered.
  await expect(page.getByRole('button', { name: 'Authorize' })).toBeVisible({
    timeout: 30_000,
  })

  // Assert the permissions-request preamble. This is the fixed English
  // copy rendered by @atproto/oauth-provider-ui in its consent-form view,
  // just above the <ul> listing the requested scopes. Anchoring on it
  // ensures we're looking at the real consent screen (not e.g. an empty
  // layout that happens to contain an Authorize button).
  await expect(
    page.getByText(
      'This application is requesting the following list of technical permissions',
    ),
  ).toBeVisible()

  // Assert the exact set of scopes rendered in the <code> list items below
  // the preamble. The upstream view renders each scope as
  // <li><code>{scope}</code></li>. Checking the exact set (not just a
  // substring match) catches both under-asking and over-asking regressions.
  const byLocale = (a: string, b: string): number => a.localeCompare(b)
  const renderedScopes = (await page.locator('ul li code').allTextContents())
    .map((s) => s.trim())
    .sort(byLocale)
  expect(renderedScopes).toEqual(
    [...DEMO_CLIENT_REQUESTED_SCOPES].sort(byLocale),
  )
})

/**
 * Fetches the client_name from a demo client's metadata document and
 * asserts that exact string is visible on the currently-displayed page.
 * Shared between the trusted / untrusted variants of the "shows the
 * demo client's name" step.
 */
async function assertClientNameVisibleFromMetadata(
  world: EpdsWorld,
  baseUrl: string,
): Promise<void> {
  const metadataUrl = `${baseUrl}/client-metadata.json`
  const res = await fetch(metadataUrl)
  if (!res.ok) {
    throw new Error(
      `Demo client metadata not found: ${res.status} at ${metadataUrl}`,
    )
  }

  const body = (await res.json()) as Record<string, unknown>
  const clientName =
    typeof body.client_name === 'string' ? body.client_name.trim() : ''
  if (!clientName) {
    throw new Error(
      `client-metadata.json at ${metadataUrl} is missing client_name`,
    )
  }

  const page = getPage(world)
  await expect(page.getByText(clientName, { exact: true })).toBeVisible()
}

Then(
  "it shows the untrusted demo client's name",
  async function (this: EpdsWorld) {
    await assertClientNameVisibleFromMetadata(this, requireUntrustedDemoUrl())
  },
)

When(
  'the untrusted demo client initiates an OAuth login',
  async function (this: EpdsWorld) {
    const page = getPage(this)
    await page.goto(requireUntrustedDemoUrl())
  },
)

Then(
  'the browser is redirected to the PDS with an access_denied error',
  async function (this: EpdsWorld) {
    const page = getPage(this)
    // Deny redirects to <PDS>/oauth/authorize?request_uri=...&error=access_denied
    await page.waitForURL('**/oauth/authorize**error=access_denied**', {
      timeout: 30_000,
    })
  },
)

Then('no consent screen is shown', async function (this: EpdsWorld) {
  const page = getPage(this)
  // If no consent screen, the user should have landed directly on /welcome.
  // We check the URL rather than asserting the button is absent, because
  // by the time this step runs the page has already navigated away.
  await page.waitForURL('**/welcome', { timeout: 30_000 })
})

// ---------------------------------------------------------------------------
// Sign-up consent-skip scenarios (trusted vs. untrusted demo clients)
// ---------------------------------------------------------------------------

When(
  'a new user signs up via the trusted demo client',
  async function (this: EpdsWorld) {
    if (!testEnv.mailpitPass) return 'pending'
    const email = `trusted-signup-${Date.now()}@example.com`
    await createAccountViaOAuth(this, email, testEnv.demoTrustedUrl)
  },
)

When(
  'a new user starts signing up via the untrusted demo client',
  async function (this: EpdsWorld) {
    if (!testEnv.mailpitPass) return 'pending'
    const email = `untrusted-signup-${Date.now()}@example.com`
    await startSignUpAwaitingConsent(this, email, requireUntrustedDemoUrl())
  },
)

Then(
  'the browser is redirected back to the trusted demo client with a valid session',
  async function (this: EpdsWorld) {
    await assertDemoClientSession(this, testEnv.demoTrustedUrl)
  },
)

Then(
  'the browser is redirected back to the untrusted demo client with a valid session',
  async function (this: EpdsWorld) {
    await assertDemoClientSession(this, requireUntrustedDemoUrl())
  },
)

Given(
  'a returning user signed up via the trusted demo client with consent skipped',
  async function (this: EpdsWorld) {
    if (!testEnv.mailpitPass) return 'pending'

    const email = `carryover-${Date.now()}@example.com`

    // Sign up via the trusted demo — the consent-skip code path fires
    // server-side because all three conditions hold (PDS flag,
    // PDS_OAUTH_TRUSTED_CLIENTS membership, client metadata opt-in).
    // createAccountViaOAuth waits for /welcome, so reaching this point
    // without a consent screen confirms the skip actually happened.
    await createAccountViaOAuth(this, email, testEnv.demoTrustedUrl)

    // Reset browser context so the second OAuth flow (against a different
    // client) starts without cookies from the sign-up — we want to test
    // whether the SCOPE authorisation carries over, not the browser session.
    await resetBrowserContext(this, sharedBrowser)
  },
)

When(
  'the user later initiates an OAuth login via the untrusted demo client',
  async function (this: EpdsWorld) {
    if (!testEnv.mailpitPass) return 'pending'
    if (!this.testEmail) {
      throw new Error(
        'No testEmail on world — the "signed up via the trusted demo client" ' +
          'Given must run first',
      )
    }

    const page = getPage(this)
    // Clear stale OTP emails before firing the new send so waitForEmail
    // below reads the code generated by this flow, not a leftover one.
    await clearMailpit(this.testEmail)

    await page.goto(requireUntrustedDemoUrl())
    await page.fill('#email', this.testEmail)
    await page.click('button[type=submit]')
    await expect(page.locator('#step-otp.active')).toBeVisible({
      timeout: 30_000,
    })

    const message = await waitForEmail(`to:${this.testEmail}`)
    const otp = await extractOtp(message.ID)
    await page.fill('#code', otp)
    await page.click('#form-verify-otp .btn-primary')
  },
)
