---
'ePDS': patch
---

Generate ES256 keypairs with `pnpm jwk:generate` instead of re-running full setup.

**Affects:** Client app developers

**Client app developers:** A new `pnpm jwk:generate` command outputs a compact ES256 private JWK (with auto-derived `kid`) on stdout. Use this when you need a keypair for `private_key_jwt` client authentication without running the full `scripts/setup.sh`. The output is suitable for the `EPDS_CLIENT_PRIVATE_JWK` environment variable (used by the bundled demo app in `packages/demo`, not by third-party client apps) or for embedding the public half in any client metadata's `jwks` field.
