---
'ePDS': patch
---

**Client app developers:** The demo's email sign-in button now says "Redirecting..." while the form is submitting, rather than "Sending verification code...". The demo is a pure OAuth client — it hands off to the auth service and has no visibility into whether a verification code will actually be sent. In the cross-client session-reuse path, no OTP email goes out at all; showing "Sending verification code..." momentarily was misleading. Matches the copy the handle-mode button (and the shared SignInButton component) already use.
