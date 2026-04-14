---
'ePDS': minor
---

Add preview routes to auth-service for iterating on client branding CSS.

**Affects:** Client app developers, Operators

**Client app developers:** When the auth-service is started with `AUTH_PREVIEW_ROUTES=1`, a set of `/preview/*` URLs becomes available that render each auth-service page (login email step, login OTP step, choose-handle, recovery email step, recovery OTP step) with fixture data. Pass `?client_id=<URL-of-your-client-metadata.json>` to inject that client's `branding.css` into the page, exactly as it would be injected during a real OAuth flow — including the same trusted-clients gate, so your `client_id` still needs to be on the operator's `PDS_OAUTH_TRUSTED_CLIENTS` for CSS to be injected. Without a `client_id` query param the preview page renders with no branding, which lets you compare the un-themed baseline against your themed version. Iterating on your CSS becomes: edit `branding.css`, refresh the preview URL — no OTP emails, no walking through the full flow each time. Visit `/preview` on the auth-service for an index of the available pages.

**Operators:** `AUTH_PREVIEW_ROUTES=1` is safe on preview deployments (Railway PR previews, `pr-base`, dev) and on local development instances. The preview routes have no effect on real auth flows — they short-circuit real state — so they can technically run in production too, but they are a developer-only surface and are best left off outside of preview/dev envs. See `packages/auth-service/.env.example` for the full note.

The pds-core-hosted consent page (from `@atproto/oauth-provider-ui`) is out of scope for this change; a similar preview for that page needs to construct the SPA's hydration-data blob and will come in a follow-up.
