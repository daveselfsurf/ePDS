/**
 * Privacy tests for renderLoginPage's OTP-step subtitle.
 *
 * When the OAuth login page reaches the OTP step by resolving a PUBLIC
 * HANDLE/DID to an account email (hideEmail=true), it must NOT echo that
 * email back — the user never typed it, so showing it (even masked) leaks
 * the account's email to anyone who knows the public handle. When the user
 * typed their own email (hideEmail=false), showing it strongly-masked is
 * fine, but the full domain/TLD must not appear.
 */
import { describe, it, expect } from 'vitest'
import { renderLoginPage } from '../routes/login-page.js'
import type { ClientMetadata } from '../lib/client-metadata.js'

const baseOpts = {
  flowId: 'flow123',
  clientId: 'https://example.com/client-metadata.json',
  clientName: 'Example',
  branding: {} as ClientMetadata,
  customCss: null,
  initialStep: 'otp' as const,
  otpAlreadySent: true,
  csrfToken: 'csrf',
  authBasePath: '/api/auth',
  pdsPublicUrl: 'https://pds.example',
  otpLength: 6,
  otpCharset: 'numeric' as const,
}

const RESOLVED_EMAIL = 'dave@attpslabs.com'

describe('renderLoginPage OTP-step email privacy', () => {
  // Helper: extract the visible OTP-step subtitle text (what the user sees).
  // The resolved email is intentionally still present in the hidden form
  // input + client JS so the OTP can be sent — this fix suppresses the
  // *display*, which is the over-the-shoulder / screenshot leak that was
  // reported.
  function subtitleOf(html: string): string {
    const m = html.match(/<p class="subtitle" id="otp-subtitle">([^<]*)<\/p>/)
    expect(m).not.toBeNull()
    return m![1]
  }

  it('hideEmail=true: visible subtitle does not show the email or its domain', () => {
    const subtitle = subtitleOf(
      renderLoginPage({ ...baseOpts, loginHint: RESOLVED_EMAIL, hideEmail: true }),
    )
    // The original bug rendered "da***@attpslabs.com" — none of it may show.
    expect(subtitle).not.toContain('dave@attpslabs.com')
    expect(subtitle).not.toContain('attpslabs.com')
    expect(subtitle).not.toContain('da***@')
    // Anti-enumeration generic message instead.
    expect(subtitle).toContain('if a matching account was found')
  })

  it('hideEmail=false: visible subtitle shows a strong mask, never the full domain', () => {
    const subtitle = subtitleOf(
      renderLoginPage({ ...baseOpts, loginHint: RESOLVED_EMAIL, hideEmail: false }),
    )
    expect(subtitle).not.toContain('dave@attpslabs.com')
    // The weak regex used to expose the bare domain — it must not.
    expect(subtitle).not.toContain('attpslabs.com')
    expect(subtitle).toContain('Code already sent to')
    expect(subtitle).toContain('***')
  })

  it('client-side script uses the generic text (not a masked email) when hideEmail is true', () => {
    const html = renderLoginPage({
      ...baseOpts,
      loginHint: 'someone@gmail.com',
      hideEmail: true,
    })
    // The auto-send subtitle path must select the generic copy.
    expect(html).toContain('hiddenEmailText')
    expect(html).toContain('var sentText = hideEmail')
  })
})
