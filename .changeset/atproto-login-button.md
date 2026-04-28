---
'ePDS': minor
---

Auth-service login page can now offer ATProto/Bluesky handle sign-in alongside email OTP.

**Affects:** End users, Client app developers, Operators

**End users:**

- When the app you came from supports it, the sign-in page now shows an "Or sign in with ATProto/Bluesky" button under the email form.
- Clicking the button switches the form into handle-entry mode (e.g. `you.bsky.social`). Submitting a handle takes you back to your own PDS to finish signing in there.
- Clicking the button again returns you to the email form.

**Client app developers:** opt in by adding `epds_handle_login_url` to your OAuth client metadata.

- The value must be an absolute https:// URL on your client's own origin. ePDS auth-service redirects the browser to that URL with `?handle=<value>` appended when the user submits a handle.
- Your route is responsible for resolving the handle to its PDS and starting a fresh OAuth flow against that PDS — auth-service is bound to one PDS and cannot start a PAR on your client's behalf, so off-PDS handles only work via this hand-off.
- The reference demo client opts in by exposing `${baseUrl}/api/oauth/login?handle=...`, which already accepts a `handle` query parameter and resolves it dynamically.
- If you do not declare `epds_handle_login_url`, the button is not rendered. Existing clients see no behaviour change.

**Operators:** no new required configuration. The button only renders for OAuth clients that explicitly opt in via their metadata.
