export default {
  paths: ['features/passwordless-authentication.feature'],
  import: ['e2e/step-definitions/**/*.ts', 'e2e/support/**/*.ts'],
  format: ['pretty', 'html:reports/e2e.html'],
  tags: 'not @manual',
  strict: true,
}
