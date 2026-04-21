---
'ePDS': patch
---

Sign-in and account pages now show an icon in the browser tab, with separate assets for light and dark browser themes.

**Affects:** End users, Operators

**End users:** When signing in, recovering an account, choosing a handle, or managing account settings, your browser tab now displays a small icon next to the page title instead of the browser's generic placeholder. The icon automatically switches between a light- and dark-theme variant to match your browser's color scheme.

**Operators:** the auth service now references `/static/favicon.svg` and `/static/favicon-dark.svg` from every rendered page `<head>`, gated by `prefers-color-scheme` media queries. Both files ship by default in `packages/auth-service/public/`. To use your own icons, replace those files (any SVG will do) — no config change required. The existing `/static` mount in `packages/auth-service/src/index.ts` serves them automatically.
