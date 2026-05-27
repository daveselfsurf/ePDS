---
'ePDS': patch
---

The `/preview/validate` page now checks `epds_handle_login_url` on your client metadata.

**Affects:** Client app developers

**Client app developers:** a new `handle-login-url` row joins the existing field checks.

- Missing or empty value warns you that the "Or sign in with ATProto/Bluesky" button won't render.
- An `http(s)://` value is ok, matching the `isSafeHttpUrl` gate that renders the button at runtime (`http://` accepted so localhost dev clients still pass).
- Any other value (`javascript:`, `file:`, unparseable) errors, because the runtime gate would silently drop the button on real flows.
