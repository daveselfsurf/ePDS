---
'ePDS': patch
---

Sign-in and account pages now show an icon in the browser tab.

**Affects:** End users, Operators

**End users:** When signing in, recovering an account, choosing a handle, or managing account settings, your browser tab now displays a small icon next to the page title instead of the browser's generic placeholder.

**Operators:** the auth service now references `/static/favicon.svg` from every rendered page `<head>`. A default `favicon.svg` ships in `packages/auth-service/public/`. To use your own icon, replace that file (any SVG will do) — no config change required. The existing `/static` mount in `packages/auth-service/src/index.ts` serves it automatically.
