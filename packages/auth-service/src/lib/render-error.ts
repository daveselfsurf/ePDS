import { escapeHtml } from '@certified-app/shared'
import { POWERED_BY_CSS, POWERED_BY_HTML } from './page-helpers.js'

const ERROR_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .page-wrap { display: flex; flex-direction: column; align-items: stretch; max-width: 420px; width: 100%; }
  ${POWERED_BY_CSS}
  .container { background: white; border-radius: 12px; padding: 40px; width: 100%; box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-align: center; }
  h1 { font-size: 24px; margin-bottom: 16px; color: #111; }
  .error { color: #dc3545; background: #fdf0f0; padding: 12px; border-radius: 8px; font-size: 15px; line-height: 1.5; }
`

export function renderError(message: string, title = 'Error'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/static/favicon.svg" media="(prefers-color-scheme: light)" type="image/svg+xml">
  <link rel="icon" href="/static/favicon-dark.svg" media="(prefers-color-scheme: dark)" type="image/svg+xml">
  <title>${escapeHtml(title)}</title>
  <style>${ERROR_CSS}</style>
</head>
<body>
  <div class="page-wrap">
    <div class="container">
      <h1>${escapeHtml(title)}</h1>
      <p class="error">${escapeHtml(message)}</p>
    </div>
    ${POWERED_BY_HTML}
  </div>
</body>
</html>`
}
