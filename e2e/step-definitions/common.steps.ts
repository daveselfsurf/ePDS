import { Given } from '@cucumber/cucumber'
import type { EpdsWorld } from '../support/world.js'
import { testEnv } from '../support/env.js'

Given('the ePDS test environment is running', async function (this: EpdsWorld) {
  const res = await fetch(`${testEnv.pdsUrl}/health`)
  if (!res.ok) {
    throw new Error(
      `PDS health check failed: ${res.status} at ${testEnv.pdsUrl}/xrpc/_health`,
    )
  }
})

Given('a demo OAuth client is registered', async function (this: EpdsWorld) {
  // No-op: Railway demo app is always registered via /client-metadata.json
})

Given(
  '{string} already has a PDS account',
  function (this: EpdsWorld, _email: string) {
    // TODO: implement account creation via full OTP sign-up flow.
    // This step should create a real account by driving the browser through
    // the demo app login → OTP → welcome flow, then the scenario can
    // re-authenticate as a returning user.
    return 'pending'
  },
)
