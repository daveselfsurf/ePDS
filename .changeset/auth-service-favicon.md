---
'ePDS': patch
---

Sign-in, account, error, and OAuth-consent pages now show an icon in the browser tab, with separate assets for light and dark browser themes.

**Affects:** End users, Operators

**End users:** When signing in, recovering an account, choosing a handle, managing account settings, landing on an error page, or seeing the OAuth consent preview, your browser tab now displays a small icon next to the page title instead of the browser's generic placeholder. The icon automatically switches between a light- and dark-theme variant to match your browser's color scheme.

**Operators:** both the auth service and pds-core now reference `/static/favicon.svg` and `/static/favicon-dark.svg` from every rendered page `<head>`, gated by `prefers-color-scheme` media queries. Both files ship by default in `packages/auth-service/public/` and `packages/pds-core/public/` (each service serves its own copy under its own origin). To use your own icons, replace those files (any SVG will do) — no config change required. The existing `/static` mounts in `packages/auth-service/src/index.ts` and `packages/pds-core/src/index.ts` serve them automatically. Each service also aliases `/favicon.ico` to its light-theme SVG so browsers that auto-request the legacy path on non-HTML responses (e.g. `/health`, XRPC JSON) still get an icon; the alias is single-variant because `prefers-color-scheme` only works via `<link>` tags in a real `<head>`.

Upstream `@atproto/oauth-provider`-rendered pages (the account chooser at `/account*`, the OAuth authorize flow at `/oauth/*`, and upstream error pages) are also covered via a response-rewrite middleware that prepends the same two favicon `<link>` tags into the `<head>` of those responses. Same single-tenant asset as the auth-service pages: replace `packages/pds-core/public/favicon*.svg` to customise.
