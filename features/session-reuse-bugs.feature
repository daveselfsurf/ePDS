@session-reuse @docker-only @email
Feature: Session-reuse resilience against stale device cookies
  When a user's upstream @atproto/oauth-provider device cookies
  (dev-id / ses-id) no longer match the server's device-session state,
  the auth-service used to redirect them anyway. That landed the user on
  pds-core's stock welcome page ("Authenticate / Create new account /
  Sign in / Cancel") instead of the enriched ePDS account picker or the
  email/OTP form.

  ePDS must recover gracefully from every variety of cookie/server
  divergence by falling back to the auth-service email/OTP form and
  clearing the stale cookies so the next visit starts clean.

  See docs/design/session-reuse-bugs.md for the full failure-mode
  taxonomy. This feature covers the externally-reproducible cases.

  Background:
    Given the ePDS test environment is running
    And a returning user has a PDS account
    And the user has completed one OAuth sign-in from the demo client
    And the browser holds a valid dev-id and ses-id cookie pair

  Scenario: Both cookies valid — baseline session reuse still works
    When the demo client starts a new OAuth flow
    Then the browser lands on the ePDS enriched account picker

  Scenario: Only dev-id is present (ses-id missing)
    Given the ses-id cookie has been evicted from the browser
    When the demo client starts a new OAuth flow
    Then the browser lands on the auth-service email-and-OTP form
    # Both cookies (and their parent-domain variants) must clear on any
    # half-pair bounce — auth-service's contract is that a half-pair
    # never survives into the next flow. Asserting only the orphan half
    # would let a regression that clears only one cookie sneak through.
    And the response clears the dev-id and ses-id cookies

  Scenario: Only ses-id is present (dev-id missing)
    Given the dev-id cookie has been evicted from the browser
    When the demo client starts a new OAuth flow
    Then the browser lands on the auth-service email-and-OTP form
    And the response clears the dev-id and ses-id cookies

  Scenario: dev-id is stale, ses-id is valid
    Given the dev-id cookie has been replaced with a well-formed but server-unknown value
    When the demo client starts a new OAuth flow
    Then the browser lands on the auth-service email-and-OTP form
    And the response clears the dev-id and ses-id cookies

  Scenario: ses-id is stale, dev-id is valid
    Given the ses-id cookie has been replaced with a well-formed but server-unknown value
    When the demo client starts a new OAuth flow
    Then the browser lands on the auth-service email-and-OTP form
    And the response clears the dev-id and ses-id cookies

  Scenario: Both cookies are stale (server-unknown pair)
    Given the dev-id and ses-id cookies have been replaced with well-formed but server-unknown values
    When the demo client starts a new OAuth flow
    Then the browser lands on the auth-service email-and-OTP form
    And the response clears the dev-id and ses-id cookies

  Scenario: "Another account" on the chooser goes to the email form
    Given the browser holds cookies for a device with at least one bound account
    When the demo client starts a new OAuth flow
    Then the browser lands on the ePDS enriched account picker
    When the user clicks "Another account" on the enriched account picker
    Then the browser lands on the auth-service email-and-OTP form

  Scenario: Upstream "Sign up" affordance is hidden on the enriched chooser
    Given the browser holds cookies for a device with at least one bound account
    When the demo client starts a new OAuth flow
    Then the browser lands on the ePDS enriched account picker
    And no upstream "Sign up" affordance is visible on the chooser

  Scenario: Chooser hides handles when the flow resolves to random handle mode
    Given the browser holds cookies for a device with at least one bound account
    When the demo client starts a new OAuth flow with random handle mode
    Then the browser lands on the ePDS enriched account picker
    And the enriched account picker renders without the handle visible
    And each row exposes the handle only via a title tooltip
    And the email remains visible as the primary identifier

  @pending
  # The purged-bindings repro needs server-side white-box access to delete
  # device_account rows out of band, which the e2e suite intentionally avoids
  # (see features/README.md). Left pending so the invariant remains visible
  # as a living spec; unit tests cover the guard's zero-bindings branch.
  Scenario: Pre-existing device whose bindings have been purged
    # Reproduces the migration-005 1h TTL purge for remember=0 rows:
    # cookies are valid and parse successfully, device row exists, but
    # the device_account row was purged so the device has zero bound
    # accounts at chooser render time.
    Given the user has a valid dev-id and ses-id pair
    And the device row exists but has zero bound accounts
    When the demo client starts a new OAuth flow
    Then the browser lands on the auth-service email-and-OTP form
    And the response clears the dev-id and ses-id cookies

  # ---------------------------------------------------------------------------
  # Pre-PR-#103 host-only cookies shadow the freshly-set Domain-scoped pair.
  # Reproduces GitHub issue #116. A user whose browser jar holds a host-only
  # dev-id/ses-id pair from before cookie-domain broadening shipped — when
  # the cookie parser keeps the first occurrence per name and per RFC 6265
  # §5.4 the host-only stale entry comes first — the welcome-page-guard
  # validates the wrong values, bounces to auth-service with prompt=login,
  # and the user loops on the OTP form. The scenario's Given clears the
  # jar (overriding what the Background's OAuth sign-in deposited) and
  # plants only the stale host-only pair, matching the actual state of
  # an affected user's browser.
  # ---------------------------------------------------------------------------

  Scenario: Stale host-only cookies don't trap the user in an OTP loop
    # The Background's account-creation step recorded the trusted demo as
    # an authorised client (PDS_SIGNUP_ALLOW_CONSENT_SKIP), so a returning
    # login skips consent and lands on /welcome. Pre-fix the user never
    # gets there — every post-callback /oauth/authorize hop bounces
    # because the host-only stale pair shadows the freshly-set
    # Domain-scoped pair.
    Given the browser jar holds only a stale host-only dev-id and ses-id pair
    When the demo client starts a new OAuth flow
    And the user enters the test email on the login page
    Then the login page shows an OTP verification form
    And an OTP email arrives in the mail trap
    When the user enters the OTP code
    Then the browser is redirected back to the demo client

  # ---------------------------------------------------------------------------
  # Flow 1 hint-vs-bindings gate: when login_hint resolves to an email that
  # is not bound to the current device, auth-service must skip session reuse
  # and surface the email/OTP form so the hinted user can sign in fresh.
  # See packages/auth-service/src/lib/session-reuse.ts shouldReuseSession
  # and packages/pds-core/src/lib/device-accounts.ts.
  # ---------------------------------------------------------------------------

  Scenario: Login hint matches a bound account — chooser still wins
    When the demo client starts a new OAuth flow with the test user's handle as login_hint
    Then the browser lands on the ePDS enriched account picker

  Scenario: Login hint resolves to an unbound account — skip chooser
    Given another user has a separate PDS account
    When the demo client starts a new OAuth flow with the other user's handle as login_hint
    Then the login page renders directly at the OTP verification step
    And the OTP form will submit the other user's email
