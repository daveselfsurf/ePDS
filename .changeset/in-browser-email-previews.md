---
'ePDS': minor
---

Preview the transactional emails ePDS sends, directly in your browser.

**Affects:** Client app developers, Operators

**Client app developers:** three new preview routes on the auth service render the exact email HTML real users receive, inside a sandboxed iframe:

- `/preview/emails/new-user` — welcome / email-verification code sent during signup.
- `/preview/emails/returning-user` — sign-in OTP sent when an existing user logs in to your app.
- `/preview/emails/recovery` — backup-email verification link sent when a user adds a recovery address.

Each route accepts the same `?client_id=<URL-of-your-client-metadata.json>` query param as the other preview pages, so you can see how your branded template will look without walking through a real OAuth flow. Optional extras: `?otp=<code>` to override the fixture OTP, `?app=<name>` to override the fixture app name on the returning-user template, `?verify_url=<url>` to override the backup-email verification link. Links for all three are wired into the `/preview` index page on the auth service.

**Operators:** gated by the existing `AUTH_PREVIEW_ROUTES=1` flag — no new environment variables. When the flag is off the new routes return 404, identical to the rest of `/preview/*`. The previews do not touch SMTP; they call the same template builders the real sender uses, so what renders is bit-for-bit what production would put in the envelope. Intended for preview and development environments; leave the flag off in production.
