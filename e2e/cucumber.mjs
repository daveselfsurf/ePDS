// Scenarios tagged @untrusted-client drive the untrusted demo OAuth client
// (see e2e/README.md#two-demo-clients). They are only runnable against
// environments that provide a second demo — reflect that in the tag
// expression by excluding the tag when E2E_DEMO_UNTRUSTED_URL is unset.
// @session-reuse (HYPER-268) requires auth-service to be on a
// subdomain of pds-core (AUTH_HOSTNAME ends with .<PDS_HOSTNAME>)
// so device-session cookies are shared. Railway preview envs can't
// satisfy this (random hostnames under a public suffix), so these
// scenarios are excluded from the default run. Enable them locally
// against a docker-compose stack where both services share a parent
// domain, by overriding this tag filter.
//
// Scenarios tagged @untrusted-client drive the untrusted demo OAuth client
// (see e2e/README.md#two-demo-clients). They are only runnable against
// environments that provide a second demo — reflect that in the tag
// expression by excluding the tag when E2E_DEMO_UNTRUSTED_URL is unset.
const tagExclusions = [
  'not @manual',
  'not @docker-only',
  'not @pending',
  'not @risk-of-disruption',
  'not @session-reuse',
  ...(process.env.E2E_DEMO_UNTRUSTED_URL ? [] : ['not @untrusted-client']),
]

export default {
  paths: ['features/**/*.feature'],
  import: ['e2e/step-definitions/**/*.ts', 'e2e/support/**/*.ts'],
  format: ['pretty', 'html:reports/e2e.html', 'junit:reports/e2e.junit.xml'],
  tags: tagExclusions.join(' and '),
  strict: true,
}
