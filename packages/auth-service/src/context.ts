import { createLogger, EpdsDb } from '@certified-app/shared'
import { EmailSender } from './email/sender.js'

export interface AuthServiceConfig {
  hostname: string
  port: number
  sessionSecret: string
  csrfSecret: string
  /** Shared HMAC-SHA256 secret for signing epds-callback redirect URLs. */
  epdsCallbackSecret: string
  pdsHostname: string
  pdsPublicUrl: string
  email: {
    provider: 'smtp' | 'sendgrid' | 'ses' | 'postmark'
    smtpHost?: string
    smtpPort?: number
    smtpUser?: string
    smtpPass?: string
    from: string
    fromName: string
  }
  dbLocation: string
  otpLength: number
  otpCharset: 'numeric' | 'alphanumeric'
  /**
   * OAuth client_id URLs trusted for branding injection. Used to gate
   * CSS branding injection AND client-supplied email templates
   * (`email_template_uri`, `email_subject_template`, `client_name`-as-
   * From display name). Untrusted clients always receive the default
   * PDS email templates.
   */
  trustedClients: string[]
}

const logger = createLogger('auth-service')

export class AuthServiceContext {
  public readonly db: EpdsDb
  public readonly emailSender: EmailSender
  public readonly config: AuthServiceConfig

  constructor(config: AuthServiceConfig) {
    this.config = config
    this.db = new EpdsDb(config.dbLocation)
    this.emailSender = new EmailSender(config.email, config.trustedClients)

    // Cleanup expired tokens every 5 minutes
    setInterval(
      () => {
        const flows = this.db.cleanupExpiredAuthFlows()
        if (flows > 0) {
          logger.debug({ flows }, 'Cleaned up expired auth flows')
        }
        this.db.cleanupOldRateLimitEntries()
        this.db.cleanupOldOtpFailures()
      },
      5 * 60 * 1000,
    )
  }

  destroy(): void {
    this.db.close()
  }
}
