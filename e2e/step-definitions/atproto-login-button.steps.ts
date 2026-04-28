/**
 * Step definitions for atproto-login-button.feature.
 *
 * Exercises the "Or sign in with ATProto/Bluesky" button rendered on
 * the auth-service login page when the OAuth client declares
 * `epds_handle_login_url` in its client metadata.
 *
 * The demo client opts in via packages/demo/src/app/client-metadata.json/route.ts.
 */

import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { testEnv } from '../support/env.js'
import type { EpdsWorld } from '../support/world.js'
import { getPage } from '../support/utils.js'

const ATPROTO_BUTTON_SELECTOR = '.btn-atproto'

Then(
  'the login page displays an {string} button',
  async function (this: EpdsWorld, label: string) {
    const page = getPage(this)
    const btn = page.locator(ATPROTO_BUTTON_SELECTOR)
    await expect(btn).toBeVisible({ timeout: 10_000 })
    await expect(btn).toHaveText(label)
  },
)

Then(
  'the login form input is in handle-entry mode',
  async function (this: EpdsWorld) {
    const page = getPage(this)
    const input = page.locator('#email')
    await expect(input).toHaveAttribute('type', 'text')
    await expect(input).toHaveAttribute('name', 'handle')
    await expect(input).toHaveAttribute('placeholder', 'you.bsky.social')
    await expect(page.locator('label[for="email"]')).toHaveText('Handle')
  },
)

Then(
  'the login form input is in email-entry mode',
  async function (this: EpdsWorld) {
    const page = getPage(this)
    const input = page.locator('#email')
    await expect(input).toHaveAttribute('type', 'email')
    await expect(input).toHaveAttribute('name', 'email')
    await expect(input).toHaveAttribute('placeholder', 'you@example.com')
    await expect(page.locator('label[for="email"]')).toHaveText('Email address')
  },
)

Then(
  'the button label changes to {string}',
  async function (this: EpdsWorld, label: string) {
    const page = getPage(this)
    await expect(page.locator(ATPROTO_BUTTON_SELECTOR)).toHaveText(label)
  },
)

When(
  'the user enters the handle {string} and submits',
  async function (this: EpdsWorld, handle: string) {
    const page = getPage(this)
    // Intercept the redirect to the demo client's /api/oauth/login route
    // and abort it. The demo route does external handle resolution
    // (handle → DID → PDS) which would either be flaky or require live
    // Bluesky access; we only need to assert the redirect URL shape.
    const expectedUrlPrefix = `${testEnv.demoUrl}/api/oauth/login`
    this.handleLoginRedirectUrl = undefined
    await page.route(`${expectedUrlPrefix}**`, (route) => {
      this.handleLoginRedirectUrl = route.request().url()
      return route.abort()
    })
    await page.fill('#email', handle)
    await page.click('#form-send-otp button[type=submit]')
  },
)

Then(
  "the browser is navigated to the demo client's handle login URL with handle {string}",
  async function (this: EpdsWorld, handle: string) {
    const page = getPage(this)
    await expect
      .poll(() => this.handleLoginRedirectUrl, { timeout: 10_000 })
      .toBeDefined()
    const current = new URL(this.handleLoginRedirectUrl as string)
    expect(current.origin + current.pathname).toBe(
      `${testEnv.demoUrl}/api/oauth/login`,
    )
    expect(current.searchParams.get('handle')).toBe(handle)
    // Stop intercepting so subsequent steps in this scenario aren't affected.
    await page.unroute(`${testEnv.demoUrl}/api/oauth/login**`)
  },
)
