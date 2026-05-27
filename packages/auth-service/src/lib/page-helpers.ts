export const POWERED_BY_HTML = ''

export const POWERED_BY_CSS = ''

export function renderOptionalStyleTag(css?: string | null): string {
  if (!css) return ''
  return `\n  <style>${css}</style>`
}

export function renderFaviconTag(
  _lightUrl?: string | null,
  _darkUrl?: string | null,
): string {
  return ''
}
