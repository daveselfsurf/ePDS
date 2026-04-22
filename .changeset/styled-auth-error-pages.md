---
'ePDS': patch
---

Error pages on the sign-in service now match the rest of the signup and login look instead of showing plain default text, and apps calling the sign-in service now receive structured error responses by default instead of HTML pages.

**Affects:** End users, Client app developers

**End users:** When a sign-in URL can't be found or something goes wrong on the sign-in service, the page shown now uses the same branded card layout as the rest of the sign-in flow, rather than the framework's unstyled default error page. The same applies to validation screens inside `/account` settings when a required field is missing or a verification link is malformed.

**Client app developers:** The auth-service 404 and 500 handlers now do proper `Accept` header negotiation. Previously they returned HTML whenever the client would accept it — including `Accept: */*`, which `fetch` and `curl` send by default — so programmatic callers received HTML error bodies. The handlers now use `req.accepts(['json', 'html'])` and only return HTML when the client explicitly prefers it; anything else (including `*/*`) returns the existing JSON shape `{ "error": "not_found" | "internal_error" }`. If you were parsing HTML error responses from auth-service, switch to the JSON shape, or send `Accept: text/html` explicitly to opt back into HTML.
