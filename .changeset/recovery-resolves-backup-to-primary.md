---
'ePDS': patch
---

Account recovery via backup email now completes the OAuth flow instead of dropping users into signup.

**Affects:** End users, Operators

**End users:** signing in via the "Recover account" link and a verified backup email now redirects back to the app you came from, with a session on your real account. Previously the recovery flow would finish the OTP step and then take you to the handle-picker page as if you were a new user, leaving you stuck.

**Operators:** no configuration changes. The bridge route `/auth/complete` now resolves a session's verified email through the `backup_email` table when there's no direct PDS account for that address, then looks up the primary email via the internal `_internal/account-by-handle` endpoint. No new environment variables, secrets, or network calls that operators need to allow beyond what auth-service already makes to pds-core.
