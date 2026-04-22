/**
 * Step definitions for features/favicon.feature.
 *
 * All HTTP-level — no browser needed. The favicon tags live in the
 * rendered HTML and are directly inspectable via fetch. This catches
 * regressions that unit tests miss:
 *   - Middleware mounted after compression in the real app.
 *   - Upstream @atproto/oauth-provider's actual `<head>` shape matching
 *     our literal `<head>` match (vs. e.g. `<head lang="en">`).
 *   - Both chooser-enrichment and favicon middleware coexisting on the
 *     same route without clobbering each other.
 */
import { Then, When } from '@cucumber/cucumber'
import type { EpdsWorld } from '../support/world.js'
import { testEnv } from '../support/env.js'

const FAVICON_LIGHT =
  '<link rel="icon" href="/static/favicon.svg" media="(prefers-color-scheme: light)" type="image/svg+xml">'
const FAVICON_DARK =
  '<link rel="icon" href="/static/favicon-dark.svg" media="(prefers-color-scheme: dark)" type="image/svg+xml">'

function serviceBaseUrl(service: string): string {
  switch (service) {
    case 'pds-core':
      return testEnv.pdsUrl
    case 'auth-service':
      return testEnv.authUrl
    default:
      throw new Error(`Unknown service: ${service}`)
  }
}

async function fetchAndRecord(world: EpdsWorld, url: string): Promise<void> {
  const res = await fetch(url, { redirect: 'manual' })
  world.lastHttpStatus = res.status
  world.lastHttpContentType = res.headers.get('content-type') ?? ''
  world.lastHttpBody = await res.text()
}

When(
  'the auth-service login page is fetched directly',
  async function (this: EpdsWorld) {
    // The auth-service root redirects into /account which in turn
    // renders the login page. We hit the login template via the
    // untrusted preview route shape — in real flows it's only reached
    // through PAR + authorize, but the HTML shell is the same template.
    // Use a realistic request_uri-less URL: the auth-service's
    // /account/sign-in page renders the login template directly.
    await fetchAndRecord(this, `${testEnv.authUrl}/account/sign-in`)
  },
)

When(
  'the pds-core {string} page is fetched directly',
  async function (this: EpdsWorld, path: string) {
    await fetchAndRecord(this, `${testEnv.pdsUrl}${path}`)
  },
)

When(
  '{string} is fetched from the {string} service',
  async function (this: EpdsWorld, path: string, service: string) {
    await fetchAndRecord(this, `${serviceBaseUrl(service)}${path}`)
  },
)

Then(
  'the HTML contains both the light and dark favicon links',
  function (this: EpdsWorld) {
    const body = this.lastHttpBody ?? ''
    if (!body.includes(FAVICON_LIGHT)) {
      throw new Error(
        `Response body is missing the light-theme favicon link.\n` +
          `Expected substring: ${FAVICON_LIGHT}\n` +
          `Got (first 500 chars): ${body.slice(0, 500)}`,
      )
    }
    if (!body.includes(FAVICON_DARK)) {
      throw new Error(
        `Response body is missing the dark-theme favicon link.\n` +
          `Expected substring: ${FAVICON_DARK}\n` +
          `Got (first 500 chars): ${body.slice(0, 500)}`,
      )
    }
  },
)

Then(
  'the response status is {int}',
  function (this: EpdsWorld, expected: number) {
    if (this.lastHttpStatus !== expected) {
      throw new Error(`Expected HTTP ${expected}, got ${this.lastHttpStatus}`)
    }
  },
)

Then(
  'the response Content-Type starts with {string}',
  function (this: EpdsWorld, expected: string) {
    const actual = this.lastHttpContentType ?? ''
    if (!actual.startsWith(expected)) {
      throw new Error(
        `Expected Content-Type starting with "${expected}", got "${actual}"`,
      )
    }
  },
)
