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
    And the stock upstream welcome page is not shown

  Scenario: Only dev-id is present (ses-id missing)
    Given the ses-id cookie has been evicted from the browser
    When the demo client starts a new OAuth flow
    Then the browser lands on the auth-service email-and-OTP form
    And the stock upstream welcome page is not shown
    And the response clears the dev-id cookie

  Scenario: Only ses-id is present (dev-id missing)
    Given the dev-id cookie has been evicted from the browser
    When the demo client starts a new OAuth flow
    Then the browser lands on the auth-service email-and-OTP form
    And the stock upstream welcome page is not shown
    And the response clears the ses-id cookie

  Scenario: dev-id is stale, ses-id is valid
    Given the dev-id cookie has been replaced with a well-formed but server-unknown value
    When the demo client starts a new OAuth flow
    Then the browser lands on the auth-service email-and-OTP form
    And the stock upstream welcome page is not shown
    And the response clears the dev-id and ses-id cookies

  Scenario: ses-id is stale, dev-id is valid
    Given the ses-id cookie has been replaced with a well-formed but server-unknown value
    When the demo client starts a new OAuth flow
    Then the browser lands on the auth-service email-and-OTP form
    And the stock upstream welcome page is not shown
    And the response clears the dev-id and ses-id cookies

  Scenario: Both cookies are stale (server-unknown pair)
    Given the dev-id and ses-id cookies have been replaced with well-formed but server-unknown values
    When the demo client starts a new OAuth flow
    Then the browser lands on the auth-service email-and-OTP form
    And the stock upstream welcome page is not shown
    And the response clears the dev-id and ses-id cookies

  Scenario: "Another account" on the chooser goes to the email form
    Given the browser holds cookies for a device with at least one bound account
    When the demo client starts a new OAuth flow
    Then the browser lands on the ePDS enriched account picker
    When the user clicks "Another account" on the enriched account picker
    Then the browser lands on the auth-service email-and-OTP form
    And the stock upstream welcome page is not shown
    And the upstream stock sign-in form is not shown

  Scenario: Upstream "Sign up" affordance is hidden on the enriched chooser
    Given the browser holds cookies for a device with at least one bound account
    When the demo client starts a new OAuth flow
    Then the browser lands on the ePDS enriched account picker
    And no upstream "Sign up" affordance is visible on the chooser

  @pending
  Scenario: Chooser hides handles when the flow resolves to random handle mode
    Given the demo client's metadata sets epds_handle_mode to random
    And the browser holds cookies for a device with at least one bound account
    When the demo client starts a new OAuth flow
    Then the enriched account picker renders without the handle visible
    And each row exposes the handle only via a title tooltip
    And the email remains visible as the primary identifier

  @pending
  Scenario: Chooser shows handles when the flow resolves to chooser handle mode
    Given the demo client's metadata sets epds_handle_mode to chooser
    And the browser holds cookies for a device with at least one bound account
    When the demo client starts a new OAuth flow
    Then the enriched account picker renders with the handle visible alongside the email

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
    And the stock upstream welcome page is not shown
    And the response clears the dev-id and ses-id cookies
