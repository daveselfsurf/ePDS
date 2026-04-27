Feature: ATProto/Bluesky handle login button on the auth-service login page
  When the OAuth client declares an `epds_handle_login_url` in its client
  metadata, the auth-service login page renders an "Or sign in with
  ATProto/Bluesky" button. The button toggles the email form into
  handle-entry mode; submitting a handle navigates the browser to the
  client's declared URL with `?handle=<value>` appended, so the client
  can resolve the handle to its PDS and start a fresh OAuth flow against
  that PDS.

  Background:
    Given the ePDS test environment is running

  Scenario: Button is rendered when the client declares epds_handle_login_url
    When the demo client initiates an OAuth login
    Then the login page displays an "Or sign in with ATProto/Bluesky" button

  Scenario: Clicking the button toggles the email form into handle-entry mode
    When the demo client initiates an OAuth login
    And the user clicks "Or sign in with ATProto/Bluesky"
    Then the login form input is in handle-entry mode
    And the button label changes to "Or sign in with email"

  Scenario: Clicking the button again returns to email-entry mode
    When the demo client initiates an OAuth login
    And the user clicks "Or sign in with ATProto/Bluesky"
    And the user clicks "Or sign in with email"
    Then the login form input is in email-entry mode

  Scenario: Submitting a handle redirects to the client's handle login URL
    When the demo client initiates an OAuth login
    And the user clicks "Or sign in with ATProto/Bluesky"
    And the user enters the handle "alice.bsky.social" and submits
    Then the browser is navigated to the demo client's handle login URL with handle "alice.bsky.social"
