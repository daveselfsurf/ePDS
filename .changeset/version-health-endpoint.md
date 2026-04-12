---
'ePDS': minor
---

The health endpoint now reports the running ePDS version.

**Affects:** Client app developers, Operators

**Client app developers:** both `/health` endpoints (pds-core and auth-service) now include a `version` field in their JSON response (e.g. `{ "status": "ok", "service": "epds", "version": "0.2.2+f37823ee" }`). You can use this to check which ePDS release your app is running against. The demo frontend also displays the version in its page footer.

**Operators:** in Docker and Railway deployments the version is automatically set to `<package.json version>+<8-char commit SHA>` at build time. In local dev it falls back to the root `package.json` version (e.g. `0.2.2`). To override, set the `EPDS_VERSION` environment variable to any string. Docker Compose users should now build with `pnpm docker:build` instead of `docker compose build` directly — the wrapper stamps the version before building, and the build will fail if the version stamp is missing.
