---
'ePDS': patch
---

Fix two preview-route cache bugs and remove long-stale debug endpoints.

**Affects:** Client app developers, Operators

**Client app developers:**

- Preview-route fetch failures no longer poison the shared client-metadata cache. Previously, a failed preview fetch for a `client_id` with a valid 10-minute entry would overwrite that entry with a 60-second branding-less fallback, silently dropping `branding.css` on real OAuth flows for up to a minute. The in-memory cache is now only written by real-flow resolution.
- The auth-service HTML preview pages (`/preview/login`, `/preview/login-otp`, `/preview/choose-handle`, `/preview/choose-handle-picker`, `/preview/recovery`, `/preview/recovery-otp`, and the `/preview` index) now send `Cache-Control: no-store`. Without it, a browser refresh could serve a cached page and never ask the server for fresh `branding.css`, breaking the advertised "edit `branding.css`, refresh the preview page" workflow.
- `/preview/validate` now flags `branding.css` whose escaped size exceeds the 32 KB injection limit as an error, instead of reporting `ok` and letting the developer discover later that their CSS was silently dropped on real OAuth flows. Byte counts now match `getClientCss()`'s measurement (escaped UTF-8).

**Operators:**

- Removed `/_internal/debug-grants` and `/_internal/debug-recent-accounts`. These were added as temporary HYPER-270 debugging endpoints with a code comment marking them for removal before PR #21 shipped (v0.2.2); they survived through v0.2.2, v0.3.0, v0.4.0, and the pending v0.5.0. The matching env var `EPDS_DEBUG_GRANTS` is no longer read.
