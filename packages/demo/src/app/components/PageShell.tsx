import { AppLogo } from './AppLogo'
import { getPageTheme } from '@/lib/theme'

interface PageShellProps {
  children: React.ReactNode
}

/**
 * Shared outer layout used by all demo login pages: full-viewport centred
 * container with the ePDS Demo logo and h1.
 *
 * When EPDS_CLIENT_THEME is set, the shell picks up the themed colours;
 * otherwise it falls back to the light defaults (matching the untrusted demo).
 */
export function PageShell({ children }: PageShellProps) {
  const t = getPageTheme()

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        padding: '20px',
        overflow: 'hidden',
        background: t?.bg ?? '#f8f9fa',
      }}
    >
      <div
        style={{
          maxWidth: '440px',
          width: '100%',
          textAlign: 'center',
        }}
      >
        <div style={{ marginBottom: '24px' }}>
          <AppLogo size={64} logoBg={t?.logoBg} />
          <h1
            style={{
              fontSize: '22px',
              fontWeight: 600,
              color: t?.text ?? '#1a1a2e',
              margin: '12px 0 4px',
            }}
          >
            {process.env.EPDS_CLIENT_NAME ?? 'ePDS Demo'}
          </h1>
        </div>
        {children}
        {process.env.NEXT_PUBLIC_EPDS_VERSION && (
          <p
            style={{
              marginTop: '32px',
              fontSize: '12px',
              color: t?.textHint ?? '#999',
            }}
          >
            ePDS {process.env.NEXT_PUBLIC_EPDS_VERSION}
          </p>
        )}
      </div>
    </div>
  )
}
