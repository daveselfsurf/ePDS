---
'ePDS': minor
---

Trusted apps can now style the sign-in and consent pages to match their own brand.

**Affects:** End users, Client app developers, Operators

**End users:** When signing in through an app that your ePDS operator has approved for branding, the login page, code entry page, handle picker, account recovery page, and consent page will display that app's colour scheme instead of the default look. The pages still work exactly the same way — only the visual appearance changes.

**Client app developers:** Add a `branding.css` field inside a `branding` object in your `client-metadata.json`. The CSS is injected as a `<style>` tag into every auth-service page and the PDS stock consent page (`/oauth/authorize`) when your `client_id` is listed in the operator's `PDS_OAUTH_TRUSTED_CLIENTS`. The CSS is size-capped at 32 KB (measured in escaped UTF-8 bytes) and sanitised to prevent `</style>` tag closure. The CSP `style-src` directive is updated with a SHA-256 hash of the injected CSS. Example metadata:

```json
{
  "client_id": "https://app.example/client-metadata.json",
  "client_name": "My App",
  "branding": {
    "css": "body { background: #0f1b2d; color: #e2e8f0; } .btn-primary { background: #3b82f6; }"
  }
}
```

Untrusted clients (not in `PDS_OAUTH_TRUSTED_CLIENTS`) never get CSS injection, regardless of what their metadata contains.

**Operators:** CSS branding injection is controlled by the existing `PDS_OAUTH_TRUSTED_CLIENTS` env var on pds-core. No new env vars are required on pds-core or auth-service. The auth-service reads the same `PDS_OAUTH_TRUSTED_CLIENTS` list to decide whether to inject CSS on its pages (login, OTP, choose-handle, recovery). See `docs/configuration.md` for the full reference.

For the demo app, a new optional `EPDS_CLIENT_THEME` env var selects a named theme preset (e.g. `ocean`) that applies consistent styling to both the demo's own pages and the CSS served in its client metadata. When unset, the demo uses the default light theme with no branding CSS. See `packages/demo/.env.example` for details.
