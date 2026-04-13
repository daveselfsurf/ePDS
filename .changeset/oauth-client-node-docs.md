---
'ePDS': patch
---

Updated login integration docs to recommend `@atproto/oauth-client-node` and confidential clients.

**Affects:** Client app developers

**Client app developers:** The tutorial and skill reference now recommend `@atproto/oauth-client-node`'s `NodeOAuthClient` for Flow 2 (no hint, handle, or DID input), which handles PAR, PKCE, DPoP, and token exchange automatically. Flow 1 (email `login_hint`) remains hand-rolled. The default client metadata example has been flipped from `"token_endpoint_auth_method": "none"` to `"private_key_jwt"` with `jwks_uri` or inline `jwks` for publishing the public key. A new "Confidential vs public clients" section explains the trade-offs — notably that public clients force a consent screen on every login. New sections cover JWKS key generation, publishing, and rotation.
