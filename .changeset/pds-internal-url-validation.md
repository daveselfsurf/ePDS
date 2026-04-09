---
'epds': patch
---

Fail-fast validation of internal environment variables on the auth
service.

**Affects:** Operators

A new `requireInternalEnv()` helper runs at auth service startup
and reports exactly which required internal variables are missing
or malformed, replacing cryptic downstream errors like
`TypeError: Failed to parse URL` on the first request.

Checks performed:

- `PDS_INTERNAL_URL` — must be set **and** must begin with `http://`
  or `https://` (matched case-insensitively). Trailing slashes are
  stripped automatically.
- `EPDS_INTERNAL_SECRET` — must be set to any non-empty string.

If you previously set `PDS_INTERNAL_URL` to a bare hostname like
`core.railway.internal` or `core:3000`, the service will now
refuse to start with this error:

```text
PDS_INTERNAL_URL is missing the http:// or https:// scheme: "core.railway.internal"
```

Add the scheme and port explicitly. The canonical Docker Compose
default (shown in `.env.example`) is `http://core:3000`; for
Railway's private networking the equivalent is
`http://<service>.railway.internal:<PDS_PORT>`, substituting
whichever service name you gave your pds-core deployment and the
`PDS_PORT` you configured on it. Railway's internal network uses
plain HTTP on explicit ports, not HTTPS. This previously "worked"
in the sense that the service started, but then failed on the
first internal request; the new behaviour surfaces the
misconfiguration immediately.
