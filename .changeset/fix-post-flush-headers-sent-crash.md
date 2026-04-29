---
'ePDS': patch
---

Fix a pds-core crash on the account chooser (`/account`) caused by response-rewrite middleware running after upstream had already flushed headers.

**Affects:** Operators

**Operators:** The chooser-enrichment and client-CSS-injection middlewares could crash pds-core with `ERR_HTTP_HEADERS_SENT` on routes where upstream `@atproto/oauth-provider` flushes headers before `res.end()` (notably `/account`). Docker's `restart: unless-stopped` masked this as a transient 502 — users saw a blank page and the container restarted in the background. Both middlewares now skip their Content-Length / ETag rewrites once the response has started. No configuration change required.
