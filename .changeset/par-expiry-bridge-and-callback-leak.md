---
'ePDS': patch
---

Sign-in no longer fails with a raw JSON error page when a user takes too long on the OTP step.

**Affects:** End users

**End users:** Previously, if you took more than five minutes between requesting your one-time code and submitting it (a slow inbox, switching tabs, fishing the code out of spam, multiple Resend cycles), sign-in could fail with a blank page showing only `{"error": "Authentication failed"}` on the PDS host — even though your OTP code itself was still valid. You now either land back inside the app you were signing into (which can offer a one-click retry), or see a styled error page on the PDS host explaining that sign-in timed out — depending on how far through the flow the timeout is detected. Either way, no more raw JSON.
