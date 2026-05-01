---
'ePDS': patch
---

"Use a different account" on the chooser now reliably takes you to the email form, not the code step for the previous account.

**Affects:** End users, Client app developers

**End users:** when you click "Another account" on the account chooser to sign in as someone else, you now always land on a fresh email entry form. Previously, if the app that started the sign-in had pre-filled an account hint, the page jumped straight to the verification-code step for the *previous* account — leaving you stuck typing a code for an account you were trying to leave.

**Client app developers:** no integration changes required. The fix tightens how `auth-service`'s `/oauth/authorize` page combines the standard OIDC `prompt=login` signal with a resolved `login_hint`: when both are present, the email step is rendered with no pre-fill, and any "code already sent" claim is suppressed so the next OTP send is treated as a fresh send. Apps that pass `login_hint` continue to land on the OTP step on a normal first visit; the change only affects the "force re-auth" path triggered by `prompt=login`.
