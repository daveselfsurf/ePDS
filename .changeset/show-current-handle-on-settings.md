---
'ePDS': minor
---

Account settings page now shows your current handle.

**Affects:** End users

**End users:** Visiting the account settings dashboard at `/account` on the auth service (not the PDS itself) now displays a "Current Handle:" row above the handle update form, so you can see at a glance what your current AT Protocol handle is before changing it. The auth service resolves the handle by calling the PDS's `com.atproto.repo.describeRepo` XRPC on every request, so the row reflects the authoritative value — including any pending rename that hasn't propagated to a local cache. If the PDS can't be reached the row displays `(unknown)` and the rest of the page still renders.
