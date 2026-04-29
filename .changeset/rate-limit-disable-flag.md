---
'ePDS': patch
---

Auth-service rate limiter can now be disabled for single-source-IP test environments.

**Affects:** Operators

Set `EPDS_DISABLE_RATE_LIMIT=true` to bypass the per-IP limiter (60 req/min) on the auth service. Only safe where every request shares one source IP (docker-compose, e2e). Leave unset in production.
