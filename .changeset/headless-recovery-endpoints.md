---
'ePDS': minor
---

First-party apps can now offer "sign in with your backup email" without redirecting users to the ePDS-hosted login page.

**Affects:** Client app developers

**Client app developers:** two new headless endpoints let an app drive account recovery server-to-server, mirroring the existing `/_internal/otp/{send,verify}` pair and authenticated the same way (per-client `x-api-key`).

- `POST /_internal/recovery/send` — body `{ backupEmail, clientId? }`. Sends a one-time code to the address if (and only if) it is a verified backup email on some account. Always responds `{ "success": true }` regardless of whether the address matches, so the endpoint cannot be used to probe which emails are registered.
- `POST /_internal/recovery/verify` — body `{ backupEmail, otp }`. Verifies the code against the backup email, resolves the underlying primary account, and returns the same session payload as `/_internal/otp/verify`: `{ did, handle, accessJwt, refreshJwt }`. On a bad code it returns `400 { "error": "InvalidCode" }`.

Both endpoints honour the calling client's `allowedOrigins` and `rateLimitPerHour`, and reject an unknown key with `401 { "error": "Unauthorized" }`. The code is sent to and keyed by the backup email, not the account's primary email — submit the same `backupEmail` to both calls.
