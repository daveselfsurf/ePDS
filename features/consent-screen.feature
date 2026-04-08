Feature: OAuth consent screen
  When a user logs into a new OAuth client for the first time, ePDS shows
  a consent screen asking for approval. Consent decisions are remembered
  per client. Sign-up consent can be skipped when all three conditions
  hold: PDS_SIGNUP_ALLOW_CONSENT_SKIP is enabled on the PDS, the client
  is listed in PDS_OAUTH_TRUSTED_CLIENTS, and the client's metadata opts
  in via "epds_skip_consent_on_signup": true. The e2e environment is
  configured with the PDS flag on and both demo clients opted in via
  metadata, so the trusted/untrusted distinction is what's exercised here.

  Background:
    Given the ePDS test environment is running
    And a demo OAuth client is registered

  Scenario: Existing user sees consent screen for a new client
    Given a returning user has a PDS account
    When the demo client initiates an OAuth login
    And the user enters the test email on the login page
    Then an OTP email arrives in the mail trap
    When the user enters the OTP code
    Then a consent screen is displayed
    And it shows the demo client's name
    When the user clicks "Approve"
    Then the browser is redirected back to the demo client with a valid session

  Scenario: User denies consent
    Given a returning user has a PDS account
    When the demo client initiates an OAuth login
    And the user enters the test email on the login page
    Then an OTP email arrives in the mail trap
    When the user enters the OTP code
    Then a consent screen is displayed
    When the user clicks "Deny"
    Then the browser is redirected to the PDS with an access_denied error

  Scenario: Returning user skips consent for a previously-approved client
    Given a returning user has already approved the demo client
    When the demo client initiates an OAuth login
    And the user enters the test email on the login page
    Then an OTP email arrives in the mail trap
    When the user enters the OTP code
    Then no consent screen is shown
    And the browser is redirected back to the demo client with a valid session

  Scenario: New user skips consent when signing up via a trusted client
    Given a new user signs up via the trusted demo client
    Then a PDS account is created
    And no consent screen is shown
    And the browser is redirected back to the trusted demo client with a valid session
    And the trusted demo client's scopes are recorded as authorized

  Scenario: New user still sees consent when signing up via an untrusted client
    Given a new user signs up via the untrusted demo client
    Then a PDS account is created
    And the consent screen is displayed (skipping account selection)
    And it shows the actual OAuth scopes requested by the untrusted demo client
    When the user clicks "Approve"
    Then the browser is redirected back to the untrusted demo client with a valid session

  Scenario: Sign-up consent skip does not carry over to a second client
    Given a user signed up via the trusted demo client with consent skipped
    When the same user later initiates an OAuth login via the untrusted demo client
    Then the consent screen is displayed for the untrusted demo client
    And the untrusted demo client's actual OAuth scopes are shown

  # TODO: automate once custom CSS injection is merged into the consent route
  # (renderConsent() needs to accept and apply clientBrandingCss from client metadata)
  @manual
  Scenario: Consent page shows client branding for trusted clients
    Given the demo client is listed in PDS_OAUTH_TRUSTED_CLIENTS
    And the demo client's metadata includes custom CSS
    When the consent screen is displayed
    Then the client's custom CSS is applied to the page
