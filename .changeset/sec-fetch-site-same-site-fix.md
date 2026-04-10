---
'ePDS': patch
---

Sign-in no longer fails when the login service and your data server share a domain name.

**Affects:** Operators

**Operators:** The upstream `@atproto/oauth-provider` rejects `sec-fetch-site: same-site`
on `GET /oauth/authorize`. This caused a `400 Forbidden sec-fetch-site header` error on
deployments where the auth service and PDS share a registrable domain (e.g.
`auth.epds1.test.certified.app` and `epds1.test.certified.app`). Browsers send `same-site`
on the 303 redirect chain from the auth subdomain to the PDS, and the upstream code does
not allow it.

pds-core now includes middleware that rewrites `sec-fetch-site: same-site` to `same-origin`
on `GET /oauth/authorize` when the request originates from the trusted auth subdomain. No
configuration changes are needed.

Additionally, DB migration v9 (which previously dropped the `client_logins` table) is now a
no-op. The table is no longer used but is kept in place to avoid breaking emergency rollbacks
to older code that still references it.

This bug was missed by the comprehensive E2E test suite due to an
unfortunate combination of quirks:

1. The upstream ATProto PDS does not support `sec-fetch-site: same-site`, marked as a
   [`@TODO`](https://github.com/bluesky-social/atproto/blob/2a9221d244a0821490458785d70d100a6943ea91/packages/oauth/oauth-provider/src/router/create-authorization-page-middleware.ts#L75-L77)
   in the source. Stock ATProto never encounters `same-site` because the PDS serves its own
   login UI on the same origin.
2. Railway does not allow any control over generated domains for PR preview environments.
   Each service gets a flat `*.up.railway.app` subdomain, and `up.railway.app` is on the
   Public Suffix List — so cross-service requests are `cross-site` (allowed), never
   `same-site`. This creates a small but ultimately significant difference in DNS topology
   from Certified infrastructure where all services share a registrable domain.
3. The deliberate introduction (in PR #21) of a double redirect from
   `auth-service/auth/complete` to `pds-core/oauth/epds-callback` to
   `pds-core/oauth/authorize`, which sends the browser through a cross-origin hop on the
   same site — the exact pattern the upstream validation rejects.
