---
'ePDS': minor
---

Sign-in pages no longer strand users on a "session expired" dead end.

**Affects:** End users, Client app developers

**End users:** if your sign-in does time out (e.g. you closed the tab and came back later, or you took longer than the heartbeat could cover), you no longer land on a static "Session expired, please start over" page with no way forward. Instead you are redirected back to the app you were signing in to, which can show its own retry button. The app you are signing in to controls the retry copy from there.

**Client app developers:**

- When a sign-in fails because the user took too long, the user is now redirected back to your registered `redirect_uri` with the standard OAuth error parameters (`error=access_denied`, `error_description=…`, and `iss`) instead of being stranded on an ePDS-hosted error page. This is the behaviour RFC 6749 §4.1.2.1 prescribes; ePDS used to short-circuit it with a static "session expired" page on a few internal paths (`/auth/complete`, `/auth/choose-handle`, the recovery flow). All of those paths now bounce back to your client.
- Internal-server-error cases (e.g. better-auth outage) redirect the same way but with `error=server_error`.
- The original `state` parameter is preserved when ePDS still has it (most paths). It is dropped when the upstream PAR row was already gone before ePDS could read it; treat the missing `state` as an anonymous error and start a fresh authorization request.
- For the rare worst case where ePDS cannot identify which OAuth client the user came from (no cookie, no flow row, no signed `client_id` on the callback), the page is now a styled error with a "Return to sign in" button targeting the client's `client_uri` from its OAuth metadata, instead of the previous text-only page.
- No changes required on your side. If you already handle the OAuth error response per spec, the only observable difference is that some flows that previously stranded the user inside ePDS now arrive at your callback with `error=access_denied`.
