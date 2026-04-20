---
'ePDS': minor
---

Trusted demo client now ships with a custom branded OTP email template.

**Affects:** Client app developers, Operators

**Client app developers:** the demo client's `client-metadata.json` now advertises `email_template_uri` (pointing at `/email-template.html` on the same origin) and `email_subject_template` (`{{code}} — your {{app_name}} code`), so operators running ePDS with the demo as a trusted client see a visually coherent login + email experience out of the box. The template is a minimal Mustache-style HTML email that respects the demo's `EPDS_CLIENT_THEME` palette: the OTP box, headings, and background all match whichever theme is active on the login and consent pages. Copy the shape from `packages/demo/src/app/email-template.html/route.ts` if you want a starting point for your own client's branded template — the supported placeholders are `{{code}}`, `{{app_name}}`, `{{logo_uri}}`, `{{email}}`, and the conditional blocks `{{#is_new_user}}…{{/is_new_user}}` / `{{^is_new_user}}…{{/is_new_user}}`.

**Operators:** no env var change is required — the demo's branded email is served automatically when you run the bundled demo client as a trusted client on `PDS_OAUTH_TRUSTED_CLIENTS`. The template is served from the demo's own origin (`<demo-base-url>/email-template.html`) with `Cache-Control: public, max-age=300`, is capped at the same 100 KB / 5 s limits `makeSafeFetch` applies to any remote email template, and is only honoured for `client_id`s on the trusted-clients list (see the `gate-email-templates-on-trusted-clients` changeset). You can verify what your users will receive by opening `/preview/emails/returning-user?client_id=<demo-base-url>/client-metadata.json` on the auth service with `AUTH_PREVIEW_ROUTES=1`.
