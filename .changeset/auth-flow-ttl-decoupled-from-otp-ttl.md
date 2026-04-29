---
'ePDS': patch
---

Sign-in no longer fails with "Authentication session expired" when an OTP code is resent after the original code times out.

**Affects:** End users

**End users:** Previously, if you took longer than 10 minutes to enter the one-time code emailed to you and then clicked **Resend code**, the new code would verify, but the next page would say "Authentication session expired. Please try again." and you would have to start the whole sign-in over. The OAuth session that was tracking your sign-in had the same 10-minute lifetime as the OTP code itself, so it had already gone away by the time the new code arrived.

The OAuth session now lives long enough to outlast a typical resend cycle, so a slow first attempt followed by Resend completes normally. The OTP code's own 10-minute lifetime is unchanged.
