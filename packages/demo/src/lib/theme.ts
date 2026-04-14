/**
 * Named theme presets for the demo client.
 *
 * Selected via `EPDS_CLIENT_THEME` env var (e.g. "ocean").
 * Each preset provides:
 *   - `page`: inline style values for the demo's own React pages
 *   - `injectedCss`: CSS string served in client-metadata.json branding,
 *     which the auth-service and pds-core CSS middleware inject into
 *     login / consent / choose-handle / recovery pages
 *
 * When `EPDS_CLIENT_THEME` is unset, `getTheme()` returns `null` and
 * callers fall back to their existing defaults (the light look the
 * untrusted demo uses).
 */

export interface PageTheme {
  /** Page background */
  bg: string
  /** Card / container surface */
  surface: string
  /** Card box-shadow */
  surfaceShadow: string
  /** Primary text */
  text: string
  /** Secondary / muted text */
  textMuted: string
  /** Tertiary / hint text */
  textHint: string
  /** Primary button background */
  primary: string
  /** Primary button hover background */
  primaryHover: string
  /** Input background */
  inputBg: string
  /** Input border */
  inputBorder: string
  /** Input focus border */
  focusBorder: string
  /** Error text */
  errorText: string
  /** Error background */
  errorBg: string
  /** Logo icon background (SVG rect fill) */
  logoBg: string
}

export interface Theme {
  page: PageTheme
  injectedCss: string
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const ocean: Theme = {
  page: {
    bg: '#0f1b2d',
    surface: '#1a2942',
    surfaceShadow: '0 2px 12px rgba(0,0,0,0.3)',
    text: '#e2e8f0',
    textMuted: '#94a3b8',
    textHint: '#64748b',
    primary: '#3b82f6',
    primaryHover: '#2563eb',
    inputBg: '#0f1b2d',
    inputBorder: '#334155',
    focusBorder: '#3b82f6',
    errorText: '#fca5a5',
    errorBg: '#450a0a',
    logoBg: '#3b82f6',
  },
  injectedCss: [
    // Page background
    'body { background: #0f1b2d; color: #e2e8f0; }',
    // Container card
    '.container { background: #1a2942; box-shadow: 0 2px 12px rgba(0,0,0,0.3); }',
    // Headings
    'h1 { color: #e2e8f0; }',
    '.subtitle { color: #94a3b8; }',
    // Form fields
    '.field label { color: #cbd5e1; }',
    '.field input { background: #0f1b2d; border-color: #334155; color: #e2e8f0; }',
    '.field input:focus { border-color: #3b82f6; }',
    '.field input::placeholder { color: #64748b; }',
    // OTP input
    '.otp-input { color: #e2e8f0; }',
    '.otp-input:focus { border-color: #3b82f6 !important; }',
    // Buttons
    '.btn-primary { background: #3b82f6; }',
    '.btn-primary:hover { background: #2563eb; }',
    '.btn-secondary { color: #94a3b8; }',
    // Social / alternative buttons
    '.btn-social { background: #0f1b2d; border-color: #334155; color: #e2e8f0; }',
    '.btn-social:hover { background: #334155; }',
    // Dividers
    '.divider { color: #64748b; }',
    '.divider::before, .divider::after { background: #334155; }',
    // Errors
    '.error { background: #450a0a; color: #fca5a5; }',
    // Recovery / secondary links
    '.recovery-link { color: #64748b; }',
    '.recovery-link:hover { color: #94a3b8; }',
    // Handle chooser
    '.handle-row { border-color: #334155; }',
    '.handle-suffix { color: #64748b; background: #0f1b2d; border-color: #334155; }',
    // Status indicators
    '.status.available { color: #4ade80; }',
    '.status.taken { color: #fca5a5; }',
    '.status.checking { color: #64748b; }',
    // Permissions list
    '.permissions { background: #0f1b2d; }',
    '.permissions li::before { color: #4ade80; }',
    // Account info box
    '.account-info { background: #1e3a5f; color: #93c5fd; }',
  ].join(' '),
}

const presets: Record<string, Theme> = {
  ocean,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the active theme, or `null` when no theme is configured.
 * Reads `EPDS_CLIENT_THEME` at call time so it works in both
 * server components and route handlers.
 */
export function getTheme(): Theme | null {
  const name = process.env.EPDS_CLIENT_THEME
  if (!name) return null
  return presets[name] ?? null
}

/**
 * Returns just the page-level style values, or `null`.
 * Server-only — reads EPDS_CLIENT_THEME at call time.
 */
export function getPageTheme(): PageTheme | null {
  return getTheme()?.page ?? null
}
