---
'ePDS': minor
---

Trusted apps can now show their own icon in the browser tab on the sign-in page.

**Affects:** End users, Client app developers, Operators

**End users:** When signing in to a trusted app, the browser tab on the sign-in, recovery, and handle-picker pages will display that app's icon instead of the default ePDS icon. No action required.

**Client app developers:** Add a `favicon_url` field (and optionally `favicon_url_dark`) under `branding` in your OAuth client metadata document. Each URL must be an absolute `https://` URL (no `http://`, no `data:` URIs, no userinfo credentials), at most 2048 characters, and **must share an origin (scheme + host + port) with your `client_id`**. When both light and dark variants are supplied, ePDS emits two `<link rel="icon">` tags gated by `prefers-color-scheme` so browsers automatically pick the variant matching the user's OS theme. When only the light variant is supplied, a single bare `<link>` is emitted and the browser uses it for both schemes. The browser fetches the favicons directly, so they must be reachable from end-user browsers and served with an appropriate `Content-Type` (`image/svg+xml`, `image/png`, `image/x-icon`, etc.). URLs failing any check are dropped — the page falls back to the default ePDS favicon, and a warning is logged server-side identifying the offending `client_id`. Example client metadata snippet for a `client_id` of `https://myapp.example/client-metadata.json`:

```json
{
  "client_name": "My App",
  "branding": {
    "css": "...",
    "favicon_url": "https://myapp.example/favicon.svg",
    "favicon_url_dark": "https://myapp.example/favicon-dark.svg"
  }
}
```

The same-origin requirement exists because the auth-service Content-Security-Policy only widens `img-src` to the `client_id` origin. A favicon hosted on a separate CDN domain would be silently blocked by the browser, so we reject it server-side instead and log it, giving operators a clear breadcrumb. To use a favicon hosted off-origin, host or proxy it under the `client_id` origin (e.g. via a `/favicon.svg` path on the same hostname that serves your client metadata).

Favicon injection is gated by the same `PDS_OAUTH_TRUSTED_CLIENTS` allowlist as `branding.css` — untrusted clients' favicons are ignored.

**Operators:** No new environment variables. The existing `PDS_OAUTH_TRUSTED_CLIENTS` allowlist now also gates favicon injection in addition to CSS injection. To opt a client into custom favicons, add their `client_id` URL to that comma-separated list as before. Operators do not need to host or proxy any client icons — they are loaded by the end user's browser directly from the URL the client provides.
