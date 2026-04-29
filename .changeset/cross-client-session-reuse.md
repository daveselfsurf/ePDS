---
'ePDS': patch
---

Signing in once in your browser now works across all apps that use this ePDS.

**Affects:** End users, Client app developers, Operators

**End users:**

- After you sign in once with any app that uses this ePDS, a second app asking you to sign in skips the email code step.
- Depending on the app, you either land straight on the "approve this app" screen or on an account chooser where you confirm which identity to reuse.
- A "Use a different account" link on the chooser takes you back to the email form for a fresh sign-in.
- The chooser shows your email next to your handle so accounts are easy to tell apart.
- If your browser's leftover sign-in cookies no longer match the server, you land on the familiar email code form rather than a generic sign-in screen.

**Client app developers:** no client-side changes required.

- When a previous sign-in's cookies are present, the user lands on the account chooser to confirm which identity to reuse.
- To force the email code form instead, append `&prompt=login` to the authorization URL the user is redirected to. ePDS reads this from the URL query string, not from the PAR body — see the `epds-login` skill for details.

**Operators:** no new required configuration.

- ePDS auto-detects whether the auth service shares a parent domain with the PDS (`AUTH_HOSTNAME` ends with `.<PDS_HOSTNAME>`) and broadens the device-session cookies to that parent so both services can read them. On unrelated hostnames (e.g. Railway preview envs under `up.railway.app`) the feature self-disables.
- Untrusted OAuth clients should be wired as confidential (`token_endpoint_auth_method=private_key_jwt`) for the "remember previous approval" path to work. The reference docker stack does this automatically and `scripts/setup.sh` generates the necessary keypairs on first run.
