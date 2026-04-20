@email
Feature: Email delivery
  ePDS sends OTP codes and verification links via email. The test
  environment uses a mail trap (Mailpit) to capture emails.

  Background:
    Given the ePDS test environment is running
    And a mail trap is capturing outbound emails

  Scenario: New user receives a welcome OTP email
    When the user requests an OTP for a unique test email
    Then an OTP email arrives in the mail trap for the test email
    And the email subject contains "Welcome"
    And the email body contains an OTP code matching the configured charset

  Scenario: Returning user receives a sign-in OTP email
    Given a returning user has a PDS account
    When the user requests an OTP for the test email
    Then an OTP email arrives in the mail trap for the test email
    And the email subject contains "Sign-in"

  Scenario: Backup email verification link is delivered
    Given the user is logged into account settings
    When the user adds a unique backup email
    Then a verification email arrives in the mail trap for the backup email
    And the email contains a verification link
