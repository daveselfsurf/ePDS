/**
 * Tests for email template rendering logic in sender.ts.
 *
 * The renderTemplate and renderSubjectTemplate functions are private,
 * so we test them indirectly through the EmailSender.sendOtpCode method
 * using a jsonTransport (no real SMTP). We also test the fetchTemplate
 * logic indirectly via sendOtpCode with mocked fetch.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { EmailSender } from '../email/sender.js'
import type { EmailConfig } from '@certified-app/shared'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

/** Create an EmailSender with jsonTransport (captures sent mail as JSON). */
function makeSender(): EmailSender {
  const config: EmailConfig = {
    // Use an invalid provider to trigger jsonTransport fallback
    provider: 'json' as 'smtp',
    from: 'test@pds.example',
    fromName: 'Test PDS',
  }
  return new EmailSender(config)
}

describe('EmailSender', () => {
  describe('sendOtpCode (default template)', () => {
    it('sends sign-in email for existing users', async () => {
      const sender = makeSender()
      // jsonTransport doesn't throw — just resolves
      await expect(
        sender.sendOtpCode({
          to: 'user@test.com',
          code: '12345678',
          clientAppName: 'Test App',
          pdsName: 'Test PDS',
          pdsDomain: 'pds.example',
          isNewUser: false,
        }),
      ).resolves.toBeUndefined()
    })

    it('sends welcome email for new users', async () => {
      const sender = makeSender()
      await expect(
        sender.sendOtpCode({
          to: 'newuser@test.com',
          code: '87654321',
          clientAppName: 'Test App',
          pdsName: 'Test PDS',
          pdsDomain: 'pds.example',
          isNewUser: true,
        }),
      ).resolves.toBeUndefined()
    })

    it('defaults to sign-in email when isNewUser is undefined', async () => {
      const sender = makeSender()
      await expect(
        sender.sendOtpCode({
          to: 'user@test.com',
          code: '11111111',
          clientAppName: 'Test App',
          pdsName: 'Test PDS',
          pdsDomain: 'pds.example',
        }),
      ).resolves.toBeUndefined()
    })
  })

  describe('sendOtpCode (client template)', () => {
    it('uses client template when available', async () => {
      const mockFetch = vi.fn((url: string) => {
        if (url === 'https://app.example/client-metadata.json') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                client_name: 'Branded App',
                email_template_uri: 'https://app.example/email-template.html',
                logo_uri: 'https://app.example/logo.png',
              }),
          })
        }
        if (url === 'https://app.example/email-template.html') {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-length': '100' }),
            text: () =>
              Promise.resolve(
                '<html><body>Your code is {{code}} for {{app_name}}</body></html>',
              ),
          })
        }
        return Promise.resolve({ ok: false })
      })
      globalThis.fetch = mockFetch as unknown as typeof fetch

      const sender = makeSender()
      // Spy on the transporter to capture the sent email
      const sendMailSpy = vi.spyOn(sender['transporter'], 'sendMail')

      await sender.sendOtpCode({
        to: 'branded@test.com',
        code: '99999999',
        clientAppName: 'Fallback Name',
        clientId: 'https://app.example/client-metadata.json',
        pdsName: 'Test PDS',
        pdsDomain: 'pds.example',
      })

      // Verify the template URL was fetched
      const fetchedUrls = mockFetch.mock.calls.map((call) => call[0])
      expect(fetchedUrls).toContain('https://app.example/email-template.html')

      // Verify the sent email uses the branded template content
      expect(sendMailSpy).toHaveBeenCalledOnce()
      const mailOpts = sendMailSpy.mock.calls[0][0] as {
        html: string
        subject: string
        from: string
      }
      expect(mailOpts.html).toContain('Your code is 99999999 for Branded App')
      expect(mailOpts.subject).toContain('Branded App')
      // From name should use the client name, not the default
      expect(mailOpts.from).toContain('Branded App')
    })

    it('falls back to default when client template fetch fails', async () => {
      const mockFetch = vi.fn((url: string) => {
        if (url.includes('client-metadata.json')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                client_name: 'Failing App',
                email_template_uri: 'https://app.example/broken-template.html',
              }),
          })
        }
        // Template fetch fails
        return Promise.reject(new Error('Network error'))
      })
      globalThis.fetch = mockFetch as unknown as typeof fetch

      const sender = makeSender()
      const sendMailSpy = vi.spyOn(sender['transporter'], 'sendMail')

      await sender.sendOtpCode({
        to: 'fallback@test.com',
        code: '44444444',
        clientAppName: 'Fallback App',
        clientId: 'https://failing.app/client-metadata.json',
        pdsName: 'Test PDS',
        pdsDomain: 'pds.example',
      })

      // Verify the broken template URL was attempted
      const fetchedUrls = mockFetch.mock.calls.map((call) => call[0])
      expect(fetchedUrls).toContain('https://app.example/broken-template.html')

      // Verify fallback to default template (sign-in, not branded)
      expect(sendMailSpy).toHaveBeenCalledOnce()
      const mailOpts = sendMailSpy.mock.calls[0][0] as {
        html: string
        subject: string
        from: string
      }
      // Default template uses pdsName in subject, not client name
      expect(mailOpts.subject).toContain('Test PDS')
      // Default template contains the sign-in code block
      expect(mailOpts.html).toContain('44444444')
      // Should NOT contain the broken template content
      expect(mailOpts.html).not.toContain('broken-template')
      // From name should be the default config, not the client name
      expect(mailOpts.from).toContain('Test PDS')
    })
  })

  describe('sendBackupEmailVerification', () => {
    it('sends verification email', async () => {
      const sender = makeSender()
      await expect(
        sender.sendBackupEmailVerification({
          to: 'backup@test.com',
          verifyUrl: 'https://pds.example/verify?token=abc123',
          pdsName: 'Test PDS',
          pdsDomain: 'pds.example',
        }),
      ).resolves.toBeUndefined()
    })
  })
})
