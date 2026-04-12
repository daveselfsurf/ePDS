---
'ePDS': patch
---

The upstream PDS version now appears on the stock health endpoint.

**Affects:** Client app developers, Operators

`/xrpc/_health` now returns the upstream `@atproto/pds` version in its JSON response (e.g. `{ "version": "0.4.211" }`). Previously this endpoint returned `{}`. This is independent of the ePDS version reported by `/health`.

**Operators:** no configuration is needed — the version is read from the installed `@atproto/pds` package at startup. To override, set the `PDS_VERSION` environment variable.
