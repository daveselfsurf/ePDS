---
'ePDS': patch
---

Security fix: client-supplied email templates now require the client to be on the trusted-clients list.

**Affects:** Client app developers, Operators

**Client app developers:** `email_template_uri`, `email_subject_template`, and the `client_name`-derived `From:` display name on OTP emails are now only honoured for clients whose `client_id` is on the PDS's `PDS_OAUTH_TRUSTED_CLIENTS` list — matching the gate that already applied to CSS branding injection. Untrusted clients receive the default ePDS OTP template with the default `From:` name. If your client isn't on the operator's trust list, advertising these fields in `client-metadata.json` has no effect; ask the operator to add your `client_id` to their trusted list.

**Operators:** `PDS_OAUTH_TRUSTED_CLIENTS` now gates email-template branding as well as CSS injection. No config change is required — the same list is reused. If you have been relying on an untrusted client's `email_template_uri` to style OTP emails (no known such case, but worth checking), add that `client_id` to `PDS_OAUTH_TRUSTED_CLIENTS` to restore the previous behaviour. Without this fix, any registered `client_id` could (a) cause the auth service to fetch an attacker-chosen URL on every OTP send, (b) ship attacker-authored HTML in an email sent from the PDS's own `noreply@` address, and (c) spoof the sender display name via `client_name`. `EMAIL_TEMPLATE_ALLOWED_DOMAINS` still applies as an additional narrowing for trusted-client template hosts.
