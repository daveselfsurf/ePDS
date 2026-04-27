---
'ePDS': minor
---

Preview the account chooser screen directly in your browser, without walking through the OAuth flow.

**Affects:** Client app developers, Operators

**Client app developers:** a new preview route on pds-core renders the account chooser with fixture sessions and your branding CSS, alongside the existing `/preview/consent` route. Open `/preview/chooser` (linked from the `/preview` index) to see how a returning user with one or more bound accounts will see your client. Inline controls on the index let you tweak the preview without editing the URL: a number field for `?numAccounts=N` (clamped to 0–10) grows or shrinks the fixture account list, and a dropdown for `?epds_handle_mode=` overrides the handle-picker mode the same way a real OAuth request can. The dropdown defaults to "Auto", which omits the param so client metadata (or the operator's env default) wins — exactly the production resolver order. The same `?client_id=<URL-of-your-client-metadata.json>` param the other preview routes accept also injects your branding CSS, subject to the standard trusted-clients gate. The existing `/preview/choose-handle` link on the auth-service index gains the same `?epds_handle_mode=` and `?error=` dropdowns and collapses the four enumerated handle-mode entries into a single link with bound controls.

**Operators:** gated by the existing `PDS_PREVIEW_ROUTES=1` flag on pds-core — no new environment variables. When the flag is off the new route returns 404, identical to the rest of `/preview/*`. Intended for preview and development environments; leave the flag off in production.
