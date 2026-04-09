---
'epds': patch
---

Mask every segment of email addresses on recovery and account-login
pages, including the domain and TLD (HYPER-259).

**Affects:** End users

Previously, the partially-masked email shown on the recovery and
account-login pages left the entire domain visible (e.g.
`jo***@gmail.com`), making the user's email address much easier to
guess for anyone who entered a known handle on the login flow. Each
dot-separated segment of both local part and domain is now masked
independently, revealing only the final character of each segment
(e.g. `persons.address@gmail.com` → `***s.***s@***l.***m`). Hiding the
domain is important: leaving a common domain visible would make
popular providers trivially identifiable, which in turn makes the
local part much more guessable.
