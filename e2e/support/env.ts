export const testEnv = {
  pdsUrl: process.env.E2E_PDS_URL ?? 'https://karmas-e2e-pds.up.railway.app',
  authUrl:
    process.env.E2E_AUTH_URL ?? 'https://certified-e2e-auth.up.railway.app',
  demoUrl:
    process.env.E2E_DEMO_URL ??
    'https://certified-appdemo-production.up.railway.app',
  mailhogUrl: process.env.E2E_MAILHOG_URL ?? '',
  headless: process.env.E2E_HEADLESS === 'true',
}
