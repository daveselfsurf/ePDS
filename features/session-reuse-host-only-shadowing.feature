@session-reuse @docker-only @email
Feature: Stale host-only device cookies must not trap users in an OTP loop
  Before PR #103 (cookie-domain broadening), @atproto/oauth-provider set
  dev-id/ses-id host-only on the pds-core host. Those cookies stay in
  the browser jar indefinitely. After PR #103, fresh sign-ins emit
  Domain-scoped cookies — but a user whose jar already holds the
  host-only pair from before the upgrade never gets to set fresh ones,
  because the host-only pair shadows everything from the very first
  /oauth/authorize hit.

  Mechanics, summarised from GitHub issue #116:

    - Browser sends the stale host-only dev-id/ses-id pair on every
      request to the pds-core host.
    - The cookie parser (used by both upstream and welcome-page-guard)
      keeps the first occurrence per name; the host-only stale value
      is what gets validated.
    - welcome-page-guard validates the wrong values, fails its check,
      bounces to auth-service with prompt=login.
    - The bounce response is meant to clear cookies in both scopes,
      but the cookie-domain middleware silently rewrites the host-only
      clear to be Domain-scoped, so the host-only stale entry survives.
    - User loops on the OTP form forever.

  ePDS must recover gracefully from this jar state by completing the
  OTP flow (or skipping it via session reuse), not by trapping the
  user. The scenarios below establish the polluted starting state
  directly — host-only stale pair on the pds-core host, no
  Domain-scoped pair, no live device session in the DB — because that
  is the actual state of an affected user's browser, and pre-fix that
  user cannot complete a sign-in to reach any other state.

  Background:
    Given the ePDS test environment is running
    And a returning user has a PDS account
    And the browser jar holds only a stale host-only dev-id and ses-id pair

  Scenario: User can complete OTP sign-in despite stale host-only cookies
    # End-to-end loop reproduction. The affected user starts an OAuth
    # flow and submits a valid OTP. They must reach the consent screen
    # (or, when no consent is required, the client app) rather than
    # being bounced back to the OTP form.
    When the demo client starts a new OAuth flow
    And the user submits a valid OTP for the existing account
    Then the browser does not land back on the OTP form
    And the stock upstream welcome page is not shown
