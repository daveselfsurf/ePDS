---
'ePDS': patch
---

The `/preview/validate` page now checks the ATProto/Bluesky hand-off URL on your client metadata.

**Affects:** Client app developers

**Client app developers:** if your client metadata declares `epds_handle_login_url` (used to render the "Or sign in with ATProto/Bluesky" button on the login page), the preview validation page now surfaces a `handle-login-url` row alongside the existing field checks.

- Missing or empty → warn ("Optional. Without it, the login page doesn't render the ATProto/Bluesky button…") so you notice if you forgot to declare it.
- Present and `http(s)://` → ok. Both schemes are accepted because the real `isSafeHttpUrl` gate in the login page also accepts `http://` for localhost dev clients.
- Present but `javascript:`, `file:`, or otherwise unparseable → error. This mirrors how the login page silently refuses to render the button on real flows, so the validator now points it out instead of letting you discover it the hard way during an OAuth round-trip.

No new metadata fields, env vars, or response shapes — only an additional row in the existing `/preview/validate` JSON output.
