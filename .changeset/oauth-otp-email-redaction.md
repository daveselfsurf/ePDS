---
'ePDS': patch
---

Signing in with a handle no longer reveals the account's email anywhere on the sign-in screen.

**Affects:** End users, Client app developers

**End users:** when you start a sign-in by entering your handle (for example via an app's "Sign in with Bluesky/ATProto" button), the verification-code screen no longer shows the email address tied to that handle — not in the visible text and not hidden in the page. Previously it displayed a partially-masked email (e.g. `da***@attpslabs.com`), and the full address was also present in the page's underlying HTML. The screen now reads "We've sent a 6-digit code to your account email." and the code is still delivered to your account's email as before. Typing your own email to sign in is unchanged.

**Client app developers:** no change to the OAuth flow or to anything your app receives — your app never received the email (the authorization-code redirect and token response carry no email). This only changes what the ePDS-hosted sign-in page does when the `login_hint` is a handle or DID: the resolved email is never sent to the browser. The verification code is sent and verified server-side, keyed to the in-progress sign-in (the `epds_auth_flow` cookie) rather than to an email field in the page.
