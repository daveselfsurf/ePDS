/**
 * Step definitions for features/session-reuse-bugs.feature — the Layer 2
 * welcome-page guard scenarios. See docs/design/session-reuse-bugs.md for
 * the failure-mode taxonomy.
 *
 * These steps exercise the pre-route guard in pds-core that intercepts
 * /oauth/authorize and /account* before upstream's signin handler can
 * render the stock welcome page. The guard bounces to auth-service when
 * the dev-id/ses-id cookie pair is missing, malformed, or resolves to a
 * device with zero bound accounts.
 *
 * All scenarios require a docker-compose topology where auth-service is a
 * sibling subdomain of pds-core so device-session cookies are domain-scoped
 * on the shared parent. Tagged @docker-only for this reason.
 */

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import type { EpdsWorld } from '../support/world.js'
import { testEnv } from '../support/env.js'
import { getPage } from '../support/utils.js'
import { createAccountViaOAuth } from '../support/flows.js'
import { clearMailpit, extractOtp, waitForEmail } from '../support/mailpit.js'

// ---------------------------------------------------------------------------
// Background: returning user completes an OAuth sign-in, leaving valid
// dev-id + ses-id cookies on the browser.
// ---------------------------------------------------------------------------

/**
 * After "a returning user has a PDS account" the account exists in the DB
 * but the browser context has been reset — dev-id/ses-id cookies are gone.
 * Drive a returning-user sign-in so upstream sets a fresh device-session
 * cookie pair on the jar without any other side effects. Mirrors the
 * pattern used by session-reuse.steps.ts's returning-session Given.
 */
Given(
  'the user has completed one OAuth sign-in from the demo client',
  async function (this: EpdsWorld) {
    if (!testEnv.mailpitPass) return 'pending'
    if (!this.testEmail) {
      const email = `reuse-${Date.now()}@example.com`
      await createAccountViaOAuth(this, email)
      return
    }
    const page = getPage(this)
    const email = this.testEmail
    await clearMailpit(email)
    await page.goto(testEnv.demoTrustedUrl)
    await page.fill('#email', email)
    await page.click('button[type=submit]')
    await expect(page.locator('#step-otp.active')).toBeVisible({
      timeout: 30_000,
    })
    const message = await waitForEmail(`to:${email}`)
    const otp = await extractOtp(message.ID)
    await page.fill('#code', otp)
    await page.click('#form-verify-otp .btn-primary')
    await page.waitForURL('**/welcome', { timeout: 30_000 })
    await clearMailpit(email)
  },
)

Given(
  'the browser holds a valid dev-id and ses-id cookie pair',
  async function (this: EpdsWorld) {
    const page = getPage(this)
    const cookies = await page.context().cookies()
    const devId = cookies.find((c) => c.name === 'dev-id')
    const sesId = cookies.find((c) => c.name === 'ses-id')
    expect(
      devId?.value,
      'dev-id cookie missing after OAuth sign-in — background set-up did not leave a device session on the jar',
    ).toBeTruthy()
    expect(
      sesId?.value,
      'ses-id cookie missing after OAuth sign-in — background set-up did not leave a device session on the jar',
    ).toBeTruthy()
  },
)

// ---------------------------------------------------------------------------
// Cookie-manipulation steps: eviction and substitution
// ---------------------------------------------------------------------------

async function evictCookie(world: EpdsWorld, name: string): Promise<void> {
  const page = getPage(world)
  const ctx = page.context()
  const all = await ctx.cookies()
  const keep = all.filter((c) => c.name !== name)
  await ctx.clearCookies()
  await ctx.addCookies(keep)
}

Given(
  'the ses-id cookie has been evicted from the browser',
  async function (this: EpdsWorld) {
    await evictCookie(this, 'ses-id')
  },
)

Given(
  'the dev-id cookie has been evicted from the browser',
  async function (this: EpdsWorld) {
    await evictCookie(this, 'dev-id')
  },
)

/** A well-formed but server-unknown cookie value: right prefix, right hex
 *  length per upstream's Zod schema, but never issued by this pds-core. */
const UNKNOWN_DEV_ID = 'dev-0123456789abcdef0123456789abcdef'
const UNKNOWN_SES_ID = 'ses-fedcba9876543210fedcba9876543210'

async function replaceCookie(
  world: EpdsWorld,
  name: string,
  value: string,
): Promise<void> {
  const page = getPage(world)
  const ctx = page.context()
  const all = await ctx.cookies()
  const target = all.find((c) => c.name === name)
  if (!target) {
    throw new Error(
      `Cannot replace cookie ${name} — it is not present on the browser jar. ` +
        'A prior Given should have established a valid cookie pair first.',
    )
  }
  const kept = all.filter((c) => c.name !== name)
  await ctx.clearCookies()
  await ctx.addCookies([...kept, { ...target, value }])
}

Given(
  'the dev-id cookie has been replaced with a well-formed but server-unknown value',
  async function (this: EpdsWorld) {
    await replaceCookie(this, 'dev-id', UNKNOWN_DEV_ID)
  },
)

Given(
  'the ses-id cookie has been replaced with a well-formed but server-unknown value',
  async function (this: EpdsWorld) {
    await replaceCookie(this, 'ses-id', UNKNOWN_SES_ID)
  },
)

Given(
  'the dev-id and ses-id cookies have been replaced with well-formed but server-unknown values',
  async function (this: EpdsWorld) {
    await replaceCookie(this, 'dev-id', UNKNOWN_DEV_ID)
    await replaceCookie(this, 'ses-id', UNKNOWN_SES_ID)
  },
)

// ---------------------------------------------------------------------------
// Trigger: start a fresh OAuth flow
// ---------------------------------------------------------------------------

When(
  'the demo client starts a new OAuth flow',
  async function (this: EpdsWorld) {
    // flow2 is the chooser-eligible variant: no login_hint, just a plain
    // "Sign in" button that posts to /api/oauth/login -> /oauth/authorize.
    // This is the flow that would have rendered the stock welcome page
    // pre-fix for every empty-device case.
    const page = getPage(this)
    const base = testEnv.demoTrustedUrl.replace(/\/$/, '')
    await page.goto(`${base}/flow2`)
    await page.click('button[type=submit]')
  },
)

When(
  'the demo client starts a new OAuth flow with random handle mode',
  async function (this: EpdsWorld) {
    // flow3 forwards handle_mode=random through to auth-service, which
    // carries epds_handle_mode=random in the /oauth/authorize query that
    // pds-core's chooser middleware reads to inject
    // <meta name="epds-handle-mode" content="random"> into the chooser's
    // <head>. The enrichment script reads that meta and hides the handle
    // span (display:none on .epds-handle-label, title= on
    // .epds-email-label) without touching the DB or the account's actual
    // stored handle.
    const page = getPage(this)
    const base = testEnv.demoTrustedUrl.replace(/\/$/, '')
    await page.goto(`${base}/flow3`)
    await page.click('button[type=submit]')
  },
)

// ---------------------------------------------------------------------------
// Assertions on landing page
// ---------------------------------------------------------------------------

Then(
  'the browser lands on the ePDS enriched account picker',
  async function (this: EpdsWorld) {
    const page = getPage(this)
    await page.waitForLoadState('networkidle', { timeout: 30_000 })
    const url = new URL(page.url())
    const pdsHost = new URL(testEnv.pdsUrl).host
    expect(
      url.host,
      `Enriched chooser should be served from ${pdsHost} but browser is on ${url.host}. URL: ${page.url()}`,
    ).toBe(pdsHost)
    await expect(page.locator('#root')).toBeAttached({ timeout: 10_000 })
    const html = await page.content()
    expect(
      html.includes('__deviceSessions') || html.includes('__sessions'),
      `Expected chooser hydration data on ${page.url()} but did not find it.`,
    ).toBe(true)
  },
)

Then(
  'the stock upstream welcome page is not shown',
  async function (this: EpdsWorld) {
    const page = getPage(this)
    // The stock welcome page renders three buttons: "Authenticate",
    // "Create a new account", and "Sign in". If any of them appear we've
    // leaked the page. We check by accessible-button label so a future
    // upstream tweak to the DOM tree does not silently bypass the assertion.
    await expect(
      page.getByRole('button', { name: 'Create a new account' }),
    ).toHaveCount(0)
    // "Sign in" is overloaded with the auth-service form's submit button —
    // but the auth-service form has an #email input that the stock welcome
    // page does not. If we find neither, the welcome page is not shown.
    // This lets the same assertion cover both the "landed on email form"
    // and "landed on chooser" cases.
    const html = await page.content()
    // The stock page uses the exact phrase "Create a new account" in the
    // button label; if that's gone, the welcome page isn't rendering.
    expect(
      html.includes('Create a new account'),
      `Expected no stock welcome page, but found its "Create a new account" button on ${page.url()}`,
    ).toBe(false)
  },
)

Then(
  'the browser lands on the auth-service email-and-OTP form',
  async function (this: EpdsWorld) {
    const page = getPage(this)
    await expect(page.locator('#email')).toBeVisible({ timeout: 30_000 })
    const url = new URL(page.url())
    const authHost = new URL(testEnv.authUrl).host
    expect(
      url.host,
      `Expected auth-service host ${authHost} but got ${url.host}`,
    ).toBe(authHost)
  },
)

Then(
  'the upstream stock sign-in form is not shown',
  async function (this: EpdsWorld) {
    const page = getPage(this)
    // Upstream @atproto/oauth-provider-ui's sign-in form has a
    // <input name="password">; the auth-service email form does not.
    // Its presence means the SPA swapped to the stock component we're
    // trying to avoid.
    await expect(page.locator('input[name="password"]')).toHaveCount(0)
    await expect(page.locator('input[name="username"]')).toHaveCount(0)
  },
)

Then(
  'no upstream "Sign up" affordance is visible on the chooser',
  async function (this: EpdsWorld) {
    const page = getPage(this)
    // ePDS has not wired upstream's signup flow (account creation goes
    // through auth-service's OTP path), so upstream's chooser-rendered
    // "Sign up" button must be hidden by chooser-enrichment.
    await expect(
      page.getByRole('button', { name: 'Sign up', exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('link', { name: 'Sign up', exact: true }),
    ).toHaveCount(0)
  },
)

// ---------------------------------------------------------------------------
// Random-handle-mode assertions on the enriched chooser (Layer 4 coverage)
// ---------------------------------------------------------------------------

Then(
  'the enriched account picker renders without the handle visible',
  async function (this: EpdsWorld) {
    const page = getPage(this)
    // The enrichment script marks the original handle span with
    // .epds-handle-label and, when the flow resolves to random mode,
    // sets display:none on it. Wait for at least one row's email label
    // to appear (a signal that the script has run) before asserting the
    // handle is hidden — otherwise we race the MutationObserver.
    await expect(page.locator('.epds-email-label').first()).toBeVisible({
      timeout: 10_000,
    })
    const handleLabels = page.locator('.epds-handle-label')
    await expect(handleLabels.first()).toBeAttached()
    const count = await handleLabels.count()
    for (let i = 0; i < count; i++) {
      await expect(handleLabels.nth(i)).not.toBeVisible()
    }
  },
)

Then(
  'each row exposes the handle only via a title tooltip',
  async function (this: EpdsWorld) {
    const page = getPage(this)
    // The script copies the hidden handle span's text into a title=
    // attribute on the adjacent .epds-email-label so power-users can
    // still inspect which account maps to which DID without the
    // gibberish random handle cluttering the visual hierarchy.
    const emailLabels = page.locator('.epds-email-label')
    const count = await emailLabels.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      const title = await emailLabels.nth(i).getAttribute('title')
      expect(
        title,
        `Row ${i}: expected .epds-email-label to carry the hidden handle as title=, got ${title === null ? 'null' : `"${title}"`}`,
      ).toBeTruthy()
      expect(title!.trim().length).toBeGreaterThan(0)
    }
  },
)

Then(
  'the email remains visible as the primary identifier',
  async function (this: EpdsWorld) {
    const page = getPage(this)
    if (!this.testEmail) {
      throw new Error(
        'world.testEmail missing — Background step must have set it via createAccountViaOAuth',
      )
    }
    // Assert at least one row's email label renders the test email as
    // visible text. Random mode hides the handle; the email must remain
    // the user-facing identifier on each row.
    const emailLabel = page
      .locator('.epds-email-label')
      .filter({ hasText: this.testEmail })
    await expect(emailLabel.first()).toBeVisible({ timeout: 5_000 })
  },
)

// ---------------------------------------------------------------------------
// Post-bounce cookie-clearing assertions
// ---------------------------------------------------------------------------

async function assertCookieCleared(
  world: EpdsWorld,
  name: string,
): Promise<void> {
  const page = getPage(world)
  const cookies = await page.context().cookies()
  const match = cookies.find((c) => c.name === name)
  expect(
    match,
    `Expected ${name} cookie to be cleared after the bounce but it is still present with value=${match?.value}`,
  ).toBeUndefined()
}

Then(
  'the response clears the dev-id and ses-id cookies',
  async function (this: EpdsWorld) {
    await assertCookieCleared(this, 'dev-id')
    await assertCookieCleared(this, 'ses-id')
  },
)

// ---------------------------------------------------------------------------
// "Another account" escape hatch from the enriched chooser (Layer 3 coverage)
// ---------------------------------------------------------------------------

Given(
  'the browser holds cookies for a device with at least one bound account',
  async function (this: EpdsWorld) {
    // Equivalent to "valid dev-id/ses-id pair" — the background already
    // establishes this via createAccountViaOAuth which leaves a bound
    // account in the DB. Delegate to the existing assertion.
    const page = getPage(this)
    const cookies = await page.context().cookies()
    const devId = cookies.find((c) => c.name === 'dev-id')
    const sesId = cookies.find((c) => c.name === 'ses-id')
    expect(devId?.value).toBeTruthy()
    expect(sesId?.value).toBeTruthy()
  },
)

When(
  'the user clicks "Another account" on the enriched account picker',
  async function (this: EpdsWorld) {
    const page = getPage(this)
    await page
      .getByRole('button', { name: 'Login to account that is not listed' })
      .click()
  },
)
