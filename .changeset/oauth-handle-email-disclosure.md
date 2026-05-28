---
'ePDS': patch
---

Signing in with a handle no longer shows your email address on the sign-in screen.

**Affects:** End users, Client app developers

**End users:** when you start a sign-in by entering your handle (for example via an app's "Sign in with Bluesky/ATProto" button), the verification-code screen no longer prints the email address tied to that handle. Previously it showed a partially-masked email like `da***@attpslabs.com`, which still revealed the full domain to anyone looking at the screen. It now reads "We've sent a 6-digit code if a matching account was found." and the code is still sent to your account's email as before. If you type your own email address to sign in (rather than a handle), it is still shown back to you so you can confirm it — but now masked more strongly, with the domain hidden too (e.g. `da***@***s.***m`).

**Client app developers:** no change to the OAuth flow or to anything your app receives — your app never received the email in the first place (the authorization-code redirect and token response carry no email). This only changes what the ePDS-hosted sign-in page displays to the user. If your app passes a handle or DID as the `login_hint`, the sign-in screen will not echo the resolved email; if it passes an email, the screen shows it masked.
