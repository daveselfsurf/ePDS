---
'ePDS': minor
---

Add preview routes on auth-service and pds-core for iterating on client branding CSS.

**Affects:** Client app developers, Operators

**Client app developers:**

- Visit `/preview` on either auth-service or pds-core for an index of every preview page. Each page renders against fixture data, so you can iterate on your `branding.css` without walking through a real OAuth flow.
- Paste your `client-metadata.json` URL into the input field on the index page. The value is persisted in your browser and wires up every preview link, subject to the same `PDS_OAUTH_TRUSTED_CLIENTS` check as a real flow. Leave it blank to see the unbranded baseline.
- The workflow becomes: edit `branding.css`, refresh any preview page. No OTP emails, no full flow.
- The demo app links directly to the auth-service preview index with its own `client_id` pre-selected.

**Operators:**

- Two new env vars gate the preview routes, one per service: `AUTH_PREVIEW_ROUTES=1` on auth-service, `PDS_PREVIEW_ROUTES=1` on pds-core. Both are independent.
- Safe to enable on preview deployments (Railway PR previews, `pr-base`, dev) and on local development instances. Preview routes don't affect real auth flows — they short-circuit real state — so they can technically run in production too, but they are a developer-only surface and are best left off outside preview/dev envs.
- **Privacy:** enabling previews exposes `/preview/cache-status`, which returns the list of `client_id` URLs currently in the shared client-metadata cache — i.e. apps that have recently started an OAuth flow against this PDS. That partially leaks which third-party clients are using the instance, so **keep previews disabled in production** unless you're comfortable with that.
- See `packages/auth-service/.env.example` and `packages/pds-core/.env.example` for the full notes.
