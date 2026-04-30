---
'ePDS': patch
---

"Powered by Certified" footer now appears on every auth-service page.

**Affects:** End users

**End users:** every page rendered by the auth service now displays the same "Powered by Certified" footer that the main sign-in already shows, so the branding is consistent end-to-end. New surfaces covered: the Account Settings sign-in flow at `/account/login` (email-entry and code-entry steps), the "Choose your handle" page shown to new users after email verification, both Account Recovery steps (backup-email entry and recovery-code entry), the `/account` settings dashboard, the backup-email verification confirmation, the post-deletion confirmation, and the generic error pages used by 404 / 500 / session-expired flows.
