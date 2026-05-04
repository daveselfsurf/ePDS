---
'ePDS': minor
---

Sign-in pages no longer strand users on a "session expired" dead end.

**Affects:** End users

**End users:** if your sign-in does time out (e.g. you closed the tab and came back later, or your wait was longer than the page-level keepalive could cover), you no longer land on a static "Session expired, please start over" page with no way forward. Instead you are redirected back to the app you were signing in to, which can show its own retry button. If something prevents that bounce-back (the app's metadata is unreachable, the originating client is unknown), the error page now offers a "Return to sign in" button instead of being text-only. Closes #151; substantially addresses #150 by replacing the dead-end at `/auth/complete` with a clean redirect.
