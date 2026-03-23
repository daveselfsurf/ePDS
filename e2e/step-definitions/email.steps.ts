import { Then } from '@cucumber/cucumber'
import type { EpdsWorld } from '../support/world.js'
import { testEnv } from '../support/env.js'

interface MailpitMessage {
  ID: string
  Subject: string
}

interface MailpitSearchResponse {
  messages?: MailpitMessage[]
}

function mailpitAuthHeader(): string {
  return `Basic ${Buffer.from(`${testEnv.mailpitUser}:${testEnv.mailpitPass}`).toString('base64')}`
}

/**
 * Poll Mailpit search until a message matching the query arrives, or timeout.
 * Returns the first matching message.
 */
async function waitForEmail(
  query: string,
  timeoutMs = 15_000,
): Promise<MailpitMessage> {
  const interval = 500
  const attempts = Math.ceil(timeoutMs / interval)
  const headers = { Authorization: mailpitAuthHeader() }

  for (let i = 0; i < attempts; i++) {
    const res = await fetch(
      `${testEnv.mailpitUrl}/api/v1/search?query=${encodeURIComponent(query)}&limit=1`,
      { headers },
    )
    const data = (await res.json()) as MailpitSearchResponse
    if (data.messages?.length) {
      return data.messages[0]
    }
    await new Promise<void>((r) => setTimeout(r, interval))
  }

  throw new Error(`No email matching "${query}" arrived within ${timeoutMs}ms`)
}

/**
 * Fetch the plain-text rendering of a message and extract the 8-digit OTP.
 * The OTP is split across two <span> elements in the HTML, so the text
 * rendering produces "XXXX YYYY" or "XXXXYYYY". Regex captures both halves.
 */
async function extractOtp(messageId: string): Promise<string> {
  const res = await fetch(`${testEnv.mailpitUrl}/view/${messageId}.txt`, {
    headers: { Authorization: mailpitAuthHeader() },
  })
  const text = await res.text()
  const match = /(\d{4})\s*(\d{4})/.exec(text)
  if (!match) {
    throw new Error(`Could not extract OTP from email body:\n${text}`)
  }
  return match[1] + match[2]
}

Then(
  'an OTP email arrives in the mail trap for the test email',
  async function (this: EpdsWorld) {
    if (!testEnv.mailpitPass) return 'pending'
    if (!this.testEmail) {
      throw new Error(
        'No test email set — "unique test email" step must run first',
      )
    }
    const message = await waitForEmail(`to:${this.testEmail}`)
    this.lastEmailSubject = message.Subject
    this.otpCode = await extractOtp(message.ID)
  },
)

Then(
  'an OTP email arrives in the mail trap for {string}',
  async function (this: EpdsWorld, email: string) {
    if (!testEnv.mailpitPass) return 'pending'
    const message = await waitForEmail(`to:${email}`)
    this.lastEmailSubject = message.Subject
    this.otpCode = await extractOtp(message.ID)
  },
)

Then('an OTP email arrives in the mail trap', async function (this: EpdsWorld) {
  if (!testEnv.mailpitPass) return 'pending'
  // TODO: The 'to:*' wildcard query doesn't work in Mailpit's search API.
  // This step is currently only reached by Scenario 2 (returning user), which
  // goes pending earlier due to unimplemented account creation. When Scenario 2
  // is implemented, replace this with a call to GET /api/v1/messages?limit=1
  // (the list endpoint) or pass the test email explicitly.
  const message = await waitForEmail('to:*')
  this.lastEmailSubject = message.Subject
  this.otpCode = await extractOtp(message.ID)
})

Then(
  'the email subject contains {string} \\(new user\\)',
  function (this: EpdsWorld, expected: string) {
    if (!testEnv.mailpitPass) return 'pending'
    if (!this.lastEmailSubject) {
      throw new Error(
        'No email subject available — email arrival step must run first',
      )
    }
    if (!this.lastEmailSubject.toLowerCase().includes(expected.toLowerCase())) {
      throw new Error(
        `Expected subject to contain "${expected}" but got: "${this.lastEmailSubject}"`,
      )
    }
  },
)

Then(
  'the email subject contains {string} \\(returning user\\)',
  function (this: EpdsWorld, expected: string) {
    if (!testEnv.mailpitPass) return 'pending'
    if (!this.lastEmailSubject) {
      throw new Error(
        'No email subject available — email arrival step must run first',
      )
    }
    if (!this.lastEmailSubject.toLowerCase().includes(expected.toLowerCase())) {
      throw new Error(
        `Expected subject to contain "${expected}" but got: "${this.lastEmailSubject}"`,
      )
    }
  },
)

Then(
  'the OTP code in the mail trap is {int} characters of uppercase letters and digits',
  function (this: EpdsWorld, length: number) {
    if (!testEnv.mailpitPass) return 'pending'
    if (!this.otpCode) return 'pending' // preceding email step went pending
    const pattern = new RegExp(`^[A-Z0-9]{${length}}$`)
    if (!pattern.test(this.otpCode)) {
      throw new Error(
        `Expected OTP to be ${length} uppercase alphanumeric characters but got: "${this.otpCode}"`,
      )
    }
  },
)
