---
'ePDS': minor
---

Service callers can now create ATProto accounts server-to-server with no email-OTP round-trip — enabling **community DIDs**: accounts that represent a community or group rather than a single human, provisioned on the community's behalf with no inbox to receive an OTP.

**Affects:** Client app developers, ePDS operators

**Client app developers:** a new headless endpoint, gated behind a dedicated per-client permission.

- `POST /_internal/account/create` — body `{ handle, email }`. Mints an invite code and creates the account directly, returning the same session payload as the OTP signup path: `{ did, handle, accessJwt, refreshJwt }`. The `handle` is the local part only (ePDS appends the handle domain) and is validated identically to the OAuth signup flow (5–20 chars, single-label, ATProto-spec-valid) — an invalid handle returns `400 { "error": "InvalidHandle" }`. The `email` is supplied by the caller and treated as opaque (no mail is sent); a community DID has no human inbox, so the address only needs to satisfy the PDS account email-uniqueness constraint.

The endpoint honours the calling client's `allowedOrigins` and `rateLimitPerHour` and rejects unknown keys with `401`, exactly like the `/_internal/otp/*` and `/_internal/recovery/*` endpoints. It additionally requires the new `can_create_directly` permission — a client without it gets `403 { "error": "DirectCreateNotAllowed" }`. Skipping the OTP step is a stronger capability than ordinary signup, so it is **off by default** and not implied by `can_signup`.

**ePDS operators:** grant the permission when minting a key with `scripts/create-api-client.mjs --can-create-directly`. A new schema migration (v11) adds the `can_create_directly` column to `api_clients`, defaulting to `0` for all existing keys.
