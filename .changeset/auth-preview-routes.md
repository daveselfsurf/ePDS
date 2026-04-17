---
'ePDS': minor
---

Add preview routes on auth-service and pds-core for iterating on client branding CSS.

**Affects:** Client app developers, Operators

**Client app developers:** Two new sets of preview routes render the ePDS sign-in pages against fixture data, so you can iterate on your `branding.css` without walking through a real OAuth flow each time. The auth-service exposes `/preview`, `/preview/login`, `/preview/login-otp`, `/preview/choose-handle`, `/preview/recovery`, and `/preview/recovery-otp`. pds-core exposes `/preview` and `/preview/consent` — the consent route renders the same `@atproto/oauth-provider-ui` SPA as the real `/oauth/authorize` page, hydrated with fixture data. Pass `?client_id=<URL-of-your-client-metadata.json>` on any of them to inject that client's `branding.css` into the page, subject to the same `PDS_OAUTH_TRUSTED_CLIENTS` check as a real OAuth flow. Without `client_id` the page renders unbranded (baseline). Iterating becomes: edit `branding.css`, refresh the preview URL — no OTP emails, no walking through the full flow. Visit `/preview` on either service for an index that lists every preview route from both services in one place (cross-service links are absolute). Landing on `/preview?client_id=<url>` pre-fills the client-metadata URL input from the query string, so shareable preview links work. The demo app also links directly to the auth-service preview index with its own `client_id` pre-selected.

**Operators:** Two new env vars gate the preview routes, one per service: `AUTH_PREVIEW_ROUTES=1` on auth-service, `PDS_PREVIEW_ROUTES=1` on pds-core. Both are independent and safe to enable on preview deployments (Railway PR previews, `pr-base`, dev) and on local development instances. The preview routes have no effect on real auth flows — they short-circuit real state — so they can technically run in production too, but they are a developer-only surface and are best left off outside of preview/dev envs. See `packages/auth-service/.env.example` and `packages/pds-core/.env.example` for the full notes.
