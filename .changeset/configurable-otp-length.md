---
'epds': minor
---

Longer sign-in codes, optionally mixing letters and numbers.

**Affects:** End users, Operators

**End users:** depending on how the ePDS instance you sign in to
is configured, sign-in codes sent to your email may now be longer
(up to 12 characters) and may include uppercase letters as well as
digits. Codes of 8 or more characters are displayed grouped in the
email for readability (e.g. `1234 5678`), but you can still paste
the whole code into the sign-in form as usual — the space is just
a visual aid.

**Operators:** two new environment variables on the auth service —
`OTP_LENGTH` (integer, range 4–12, default 8) and `OTP_CHARSET`
(`numeric` (default) or `alphanumeric`; `alphanumeric` uses uppercase
A–Z plus 0–9). Values outside the range cause the service to fail on
startup. The OTP form fields (input width, `pattern`, `inputmode`,
`autocapitalize`) adapt automatically from the configured length and
charset; no template changes are required.

**Operators running custom email templates:** the shared email
helpers now format OTPs with visual grouping when the code is 8
characters or longer — e.g. `1234 5678` in subject lines and plain
text, and `<span>1234</span><span>5678</span>` with CSS spacing in
HTML so that copy-paste still yields the flat code. If you render
OTPs yourself rather than going through `EmailSender.sendOtpCode()`,
import `formatOtpPlain()` and `formatOtpHtmlGrouped()` from
`@certified-app/shared` instead of interpolating the raw code.
