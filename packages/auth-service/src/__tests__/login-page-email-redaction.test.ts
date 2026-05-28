/**
 * Privacy tests: the OAuth login page must not expose the account email on
 * the HANDLE path — neither displayed nor anywhere in the page source.
 *
 * When a public handle/DID is resolved to an email, the page is rendered
 * with emailFromHandle=true and an empty loginHint; the email lives only on
 * the auth_flow row server-side, and the browser drives OTP via the
 * flow-keyed endpoints. So the resolved email must appear nowhere in the
 * HTML (no visible subtitle, no hidden input value, no JS var).
 */
import { describe, it, expect } from 'vitest'
import { renderLoginPage } from '../routes/login-page.js'
import type { ClientMetadata } from '../lib/client-metadata.js'

const baseOpts = {
  flowId: 'flow123',
  clientId: 'https://leaflet.pub/client-metadata.json',
  clientName: 'Leaflet',
  branding: {} as ClientMetadata,
  customCss: null,
  csrfToken: 'csrf-token-abc',
  authBasePath: '/api/auth',
  pdsPublicUrl: 'https://self.surf',
  otpLength: 6,
  otpCharset: 'numeric' as const,
  initialStep: 'otp' as const,
  otpAlreadySent: false,
}

const RESOLVED_EMAIL = 'dave@attpslabs.com'

describe('renderLoginPage — handle path (emailFromHandle=true)', () => {
  // On the handle path the route passes an empty loginHint (the email is
  // never sent to the browser) and emailFromHandle=true.
  const html = renderLoginPage({
    ...baseOpts,
    loginHint: '',
    emailFromHandle: true,
  })

  it('does not contain the resolved email anywhere in the page', () => {
    expect(html).not.toContain('dave@attpslabs.com')
  })

  it('does not contain the email domain anywhere in the page', () => {
    expect(html).not.toContain('attpslabs.com')
  })

  it('does not leak a weak-regex masked form', () => {
    expect(html).not.toContain('da***@')
  })

  it('the hidden otp-email input is empty', () => {
    expect(html).toMatch(/id="otp-email"[^>]*value=""/)
  })

  it('uses the flow-keyed endpoints and constant anti-enumeration copy', () => {
    expect(html).toContain('/auth/otp/send-by-flow')
    expect(html).toContain('/auth/otp/verify-by-flow')
    expect(html).toContain('to your account email')
    // Carries the CSRF token for the same-origin POSTs.
    expect(html).toContain('csrf-token-abc')
  })
})

describe('renderLoginPage — email-typed path (emailFromHandle=false)', () => {
  it('still pre-fills the email the user supplied (unchanged behavior)', () => {
    const html = renderLoginPage({
      ...baseOpts,
      loginHint: RESOLVED_EMAIL,
      emailFromHandle: false,
      otpAlreadySent: true,
    })
    // On the email-typed path the email is the user's own — pre-filling the
    // hidden input is expected.
    expect(html).toMatch(/id="otp-email"[^>]*value="dave@attpslabs.com"/)
  })
})
