---
'epds': patch
---

Signing in recovers cleanly when your browser's leftover session cookies no longer match the server.

**End users:** stale or mismatched device-session cookies now drop you onto the familiar email code form instead of a generic sign-in screen. The chooser's "Another account" goes to the same form, and the upstream sign-up button is hidden — account creation runs through the email flow.

**Client app developers:** `/oauth/authorize` now requires both `dev-id` and `ses-id` cookies; half-pairs and stale pairs are cleared and bounced to the email form. pds-core mounts a pre-route guard in front of `/oauth/authorize` and `/account` that bounces requests whose cookies don't resolve to a device with bound accounts and a matching active session id, so upstream's stock welcome page is never rendered. The chooser hides upstream's "Sign up" and rebinds "Another account" via a capture-phase listener.

**Operators:** one optional knob. The auth-service per-IP rate limiter (60 req/min) can be bypassed by setting `EPDS_DISABLE_RATE_LIMIT=true`, which is the right setting for docker-compose / e2e stacks where every request comes from one source IP. Leave it unset in production. Handle-mode resolution on the chooser now follows the same precedence as the signup form (`epds_handle_mode` query → client metadata → env var → `picker-with-random`).

The reference docker stack now wires both demo containers as confidential OAuth clients (`token_endpoint_auth_method=private_key_jwt`) with cryptographically distinct ES256 keypairs. `scripts/setup.sh` auto-generates the second keypair (`DEMO_UNTRUSTED_PRIVATE_JWK`) alongside the existing demo keypair on first run. Without this, upstream `@atproto/oauth-provider` force-overrides `prompt=consent` for untrusted public clients in `request-manager.js`, which suppresses the "remember consent for previously-authorized clients" path and breaks cross-client session-reuse e2e scenarios. Distinct keypairs also prevent either demo from forging `client_assertion` JWTs claiming to be the other at the token endpoint.
