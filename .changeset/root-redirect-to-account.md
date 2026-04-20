---
'ePDS': patch
---

Visiting the bare auth service URL now takes you to the account page instead of a blank 404.

**Affects:** End users, Operators

**End users:** Opening the auth service at its root URL (e.g. `https://auth.example.com/`) now redirects to the account dashboard. If you are signed in you land on `/account`; if you are not, `/account` bounces you on to `/account/login` as before. Previously the root path had no handler and returned a 404 "Cannot GET /" page, which was confusing when bookmarking or mistyping a URL.

**Operators:** The auth service now returns a `303 See Other` with `Location: /account` for `GET /`. If you have an external healthcheck pointed at `/` expecting a 404, switch it to `/health` (which already exists and returns a JSON status body). `/health` is unchanged.
