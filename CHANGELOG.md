# ePDS

## 0.2.2

### Who should read this release

- **Everyone (end users, client app developers, operators):**
  - [The permissions shown on the sign-in consent screen now match what the app actually asked for.](#v0.2.2-the-permissions-shown-on-the-sign-in-consent-screen-now)
  - [Trusted apps can optionally skip the consent screen when new users sign up.](#v0.2.2-trusted-apps-can-optionally-skip-the-consent-screen)
- **Operators also:**
  - [Sign-in no longer fails when the login service and your data server share a domain name.](#v0.2.2-sign-in-no-longer-fails-when-the-login-service-and-your)

### Patch Changes

- <a id="v0.2.2-the-permissions-shown-on-the-sign-in-consent-screen-now"></a> [#21](https://github.com/hypercerts-org/ePDS/pull/21) [`10287ca`](https://github.com/hypercerts-org/ePDS/commit/10287cad14478ef3a877abdf0b581342ce7842c8) Thanks [@aspiers](https://github.com/aspiers)! - The permissions shown on the sign-in consent screen now match what the app actually asked for.

  **Affects:** End users, Client app developers, Operators

  **End users:** When you sign in to a third-party app through ePDS and are asked to approve what the app can do with your account, the list you see now reflects the permissions that particular app actually requested. Previously the screen always showed the same hard-coded list ("Read and write posts", "Access your profile", "Manage your follows") no matter which app you were signing in to, which was misleading. The consent screen itself also now looks and behaves like the standard AT Protocol consent screen used elsewhere in the ecosystem.

  **Client app developers:** The consent screen rendered at `/oauth/authorize` is now the stock `@atproto/oauth-provider` `consent-view.tsx`, driven by the real `scope` / `permissionSets` your client requests. The previous auth-service implementation ignored the requested scopes entirely. After OTP verification and (for new users) account creation, `epds-callback` now binds the device session via `upsertDeviceAccount()` and redirects through `/oauth/authorize`, so the upstream `oauthMiddleware` runs `provider.authorize()` — including `checkConsentRequired()` — against the actual request. Clients that only need scopes the user has already approved will now be auto-approved instead of being shown a redundant consent screen. Support for branding the consent screen is currently being worked on.

  **Operators:** No configuration changes are required. Consent state now lives in the upstream provider's `authorizedClients` tracking. The `client_logins` table is no longer used but is left in place (not dropped) to avoid breaking rollbacks in case they were ever needed.

- <a id="v0.2.2-trusted-apps-can-optionally-skip-the-consent-screen"></a> [#21](https://github.com/hypercerts-org/ePDS/pull/21) [`5110845`](https://github.com/hypercerts-org/ePDS/commit/5110845) Thanks [@aspiers](https://github.com/aspiers)! - Trusted apps can optionally skip the consent screen when new users sign up.

  **Affects:** End users, Client app developers, Operators

  **End users:** When you create a new account through a trusted app, ePDS can now send you straight back to that app without showing a separate consent screen first.

  **Client app developers:** To opt in, your client metadata must include `epds_skip_consent_on_signup: true`. The skip only applies on initial sign-up, only for trusted clients, and only when the server is configured to allow it.

  **Operators:** This feature has separate configuration from the normal consent-screen changes. To enable it, set `PDS_SIGNUP_ALLOW_CONSENT_SKIP=true`. The skip only applies to clients already trusted via `PDS_OAUTH_TRUSTED_CLIENTS` and only when the client metadata opts in with `epds_skip_consent_on_signup: true`.

- <a id="v0.2.2-sign-in-no-longer-fails-when-the-login-service-and-your"></a> [#65](https://github.com/hypercerts-org/ePDS/pull/65) [`313c071`](https://github.com/hypercerts-org/ePDS/commit/313c07176ac04ae6f517f18cfe95cf15af1d0812) Thanks [@aspiers](https://github.com/aspiers)! - Sign-in no longer fails when the login service and your data server share a domain name.

  **Affects:** Operators

  **Operators:** The upstream `@atproto/oauth-provider` rejects `sec-fetch-site: same-site` on `GET /oauth/authorize`. This caused a `400 Forbidden sec-fetch-site header` error on deployments where the auth service and PDS share a registrable domain (e.g.  `auth.epds1.test.certified.app` and `epds1.test.certified.app`). Browsers send `same-site` on the 303 redirect chain from the auth subdomain to the PDS, and the upstream code does not allow it.

  pds-core now includes middleware that rewrites `sec-fetch-site: same-site` to `same-origin` on `GET /oauth/authorize` when the request originates from the trusted auth subdomain. No configuration changes are needed.

  Additionally, DB migration v9 (which previously dropped the `client_logins` table) is now a no-op. The table is no longer used but is kept in place to avoid breaking emergency rollbacks to older code that still references it.

  This bug was missed by the comprehensive E2E test suite due to an unfortunate combination of quirks:

  1. The upstream ATProto PDS does not support `sec-fetch-site: same-site`, marked as a [`@TODO`](https://github.com/bluesky-social/atproto/blob/2a9221d244a0821490458785d70d100a6943ea91/packages/oauth/oauth-provider/src/router/create-authorization-page-middleware.ts#L75-L77) in the source. Stock ATProto never encounters `same-site` because the PDS serves its own login UI on the same origin.
  2. Railway does not allow any control over generated domains for PR preview environments.  Each service gets a flat `*.up.railway.app` subdomain, and `up.railway.app` is on the Public Suffix List — so cross-service requests are `cross-site` (allowed), never `same-site`. This creates a small but ultimately significant difference in DNS topology from Certified infrastructure where all services share a registrable domain.
  3. The deliberate introduction (in PR [#21](https://github.com/hypercerts-org/ePDS/issues/21)) of a double redirect from `auth-service/auth/complete` to `pds-core/oauth/epds-callback` to `pds-core/oauth/authorize`, which sends the browser through a cross-origin hop on the same site — the exact pattern the upstream validation rejects.

## 0.2.1

### Who should read this release

- **End users:**
  - [Mask every segment of email addresses on recovery and account-login pages, including the domain and TLD (HYPER-259).](#v0.2.1-mask-every-segment-of-email-addresses-on-recovery-and)

### Patch Changes

- <a id="v0.2.1-mask-every-segment-of-email-addresses-on-recovery-and"></a> [#51](https://github.com/hypercerts-org/ePDS/pull/51) [`cfaeabe`](https://github.com/hypercerts-org/ePDS/commit/cfaeabed56d2d745335295f5a653b5358447ecca) Thanks [@aspiers](https://github.com/aspiers)! - Mask every segment of email addresses on recovery and account-login pages, including the domain and TLD (HYPER-259).

  **Affects:** End users

  Previously, the partially-masked email shown on the recovery and account-login pages left the entire domain visible (e.g.  `jo***@gmail.com`), making the user's email address much easier to guess for anyone who entered a known handle on the login flow. Each dot-separated segment of both local part and domain is now masked independently, revealing only the final character of each segment (e.g. `persons.address@gmail.com` → `***s.***s@***l.***m`). Hiding the domain is important: leaving a common domain visible would make popular providers trivially identifiable, which in turn makes the local part much more guessable.

## 0.2.0

### Who should read this release

- **End users:**
  - [Longer sign-in codes, optionally mixing letters and numbers.](#v0.2.0-longer-sign-in-codes-optionally-mixing-letters-and-numbers)
  - [Choose your own handle when signing up, instead of being given a random one.](#v0.2.0-choose-your-own-handle-when-signing-up-instead-of-being)
  - [Sign in faster from third-party apps that already know who you are.](#v0.2.0-sign-in-faster-from-third-party-apps-that-already-know-who)
- **Client app developers:**
  - [Choose your own handle when signing up, instead of being given a random one.](#v0.2.0-choose-your-own-handle-when-signing-up-instead-of-being)
- **Operators:**
  - [Longer sign-in codes, optionally mixing letters and numbers.](#v0.2.0-longer-sign-in-codes-optionally-mixing-letters-and-numbers)
  - [Choose your own handle when signing up, instead of being given a random one.](#v0.2.0-choose-your-own-handle-when-signing-up-instead-of-being)
  - [Fail-fast validation of internal environment variables on the auth service.](#v0.2.0-fail-fast-validation-of-internal-environment-variables-on)
  - [Honour the generic `PORT` environment variable on both services, so Railway's automatic healthcheck succeeds without per-service configuration.](#v0.2.0-honour-the-generic-environment-variable-on-both-services-so)

### Minor Changes

- <a id="v0.2.0-longer-sign-in-codes-optionally-mixing-letters-and-numbers"></a> [#14](https://github.com/hypercerts-org/ePDS/pull/14) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Longer sign-in codes, optionally mixing letters and numbers.

  **Affects:** End users, Operators

  **End users:** depending on how the ePDS instance you sign in to is configured, sign-in codes sent to your email may now be longer (up to 12 characters) and may include uppercase letters as well as digits. Codes of 8 or more characters are displayed grouped in the email for readability (e.g. `1234 5678`), but you can still paste the whole code into the sign-in form as usual — the space is just a visual aid.

  **Operators:** two new environment variables on the auth service — `OTP_LENGTH` (integer, range 4–12, default 8) and `OTP_CHARSET` (`numeric` (default) or `alphanumeric`; `alphanumeric` uses uppercase A–Z plus 0–9). Values outside the range cause the service to fail on startup. The OTP form fields (input width, `pattern`, `inputmode`, `autocapitalize`) adapt automatically from the configured length and charset; no template changes are required.

  **Operators running custom email templates:** the shared email helpers now format OTPs with visual grouping when the code is 8 characters or longer — e.g. `1234 5678` in subject lines and plain text, and `<span>1234</span><span>5678</span>` with CSS spacing in HTML so that copy-paste still yields the flat code. If you render OTPs yourself rather than going through `EmailSender.sendOtpCode()`, import `formatOtpPlain()` and `formatOtpHtmlGrouped()` from `@certified-app/shared` instead of interpolating the raw code.

- <a id="v0.2.0-choose-your-own-handle-when-signing-up-instead-of-being"></a> [#13](https://github.com/hypercerts-org/ePDS/pull/13) [#29](https://github.com/hypercerts-org/ePDS/pull/29) [#33](https://github.com/hypercerts-org/ePDS/pull/33) [#36](https://github.com/hypercerts-org/ePDS/pull/36) Thanks [@Kzoeps](https://github.com/Kzoeps) & [@aspiers](https://github.com/aspiers)! - Choose your own handle when signing up, instead of being given a random one.

  **Affects:** End users, Client app developers, Operators

  **End users:** the signup flow now shows a handle picker by default instead of assigning a random handle. You can type a custom handle and the picker will check availability as you type, or click the random-handle button to take what the old flow would have given you. The picker now accepts handles as short as 5 characters and handles are validated more strictly so that some handles that used to be accepted may now be rejected up-front with a clearer error.  The picker layout has been widened to accommodate long PDS domain names without truncation.

  **Client app developers (building on top of ePDS):** a new `epds_handle_mode` setting controls which variant of the signup handle picker is shown. Accepted case-sensitive values:

  - `picker` — always show the picker, no random option offered.
  - `random` — always assign a random handle, no picker (the
    pre-0.2.0 behaviour).
  - `picker-with-random` _(default)_ — show the picker but include a
    "generate random" option.

  The setting is resolved with the following precedence (first match wins), falling back to a built-in default:

  1. `epds_handle_mode` query parameter on the `/oauth/authorize` request.
  2. `epds_handle_mode` field in the OAuth **client metadata JSON** served at the client's `client_id` URL.
  3. `EPDS_DEFAULT_HANDLE_MODE` environment variable on the auth service.
  4. Built-in default: `picker-with-random`.

  This precedence was previously wrong — the env var was consulted before the client metadata, so clients could not override a server default. If you relied on that bug, your env var setting will now be overridden by whatever the client metadata says.

  To force a specific handle mode for users of your app, add the field to the client metadata JSON that your `client_id` URL returns, alongside the standard OAuth fields:

  ```json
  {
    "client_id": "https://example.com/oauth/client-metadata.json",
    "client_name": "Example",
    "redirect_uris": ["https://example.com/oauth/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "scope": "atproto transition:generic",
    "token_endpoint_auth_method": "none",
    "application_type": "web",
    "dpop_bound_access_tokens": true,
    "epds_handle_mode": "picker"
  }
  ```

  Unknown or invalid values are silently ignored and fall through to the next source. If you need to override per-request (e.g. for a specific signup campaign), append `?epds_handle_mode=picker` to your `/oauth/authorize` URL.

  **Operators:** set `EPDS_DEFAULT_HANDLE_MODE` on the auth service to change the default handle-picker variant for clients that don't specify one in their client metadata. Accepted values are the same as those listed in the Client app developers section above (`picker`, `random`, `picker-with-random`). See `.env.example` for documentation.

### Patch Changes

- <a id="v0.2.0-sign-in-faster-from-third-party-apps-that-already-know-who"></a> [#3](https://github.com/hypercerts-org/ePDS/pull/3) [#6](https://github.com/hypercerts-org/ePDS/pull/6) Thanks [@aspiers](https://github.com/aspiers)! - Sign in faster from third-party apps that already know who you are.

  **Affects:** End users

  When you sign in to a third-party AT Protocol app (anything built on top of the Bluesky account system, for example) that already knows your handle or DID, ePDS now jumps straight to the "enter your sign-in code" step. Previously you would have been asked to retype your email address first, even though the app you were using had already identified you — that extra step is gone.

  This fixes two specific situations that didn't work before: apps that identified you by handle or DID rather than email, and apps that sent the identifier over a back channel rather than in the sign-in URL.

- <a id="v0.2.0-fail-fast-validation-of-internal-environment-variables-on"></a> [#20](https://github.com/hypercerts-org/ePDS/pull/20) [#23](https://github.com/hypercerts-org/ePDS/pull/23) Thanks [@aspiers](https://github.com/aspiers)! - Fail-fast validation of internal environment variables on the auth service.

  **Affects:** Operators

  A new `requireInternalEnv()` helper runs at auth service startup and reports exactly which required internal variables are missing or malformed, replacing cryptic downstream errors like `TypeError: Failed to parse URL` on the first request.

  Checks performed:

  - `PDS_INTERNAL_URL` — must be set **and** must begin with `http://` or `https://` (matched case-insensitively). Trailing slashes are stripped automatically.
  - `EPDS_INTERNAL_SECRET` — must be set to any non-empty string.

  If you previously set `PDS_INTERNAL_URL` to a bare hostname like `core.railway.internal` or `core:3000`, the service will now refuse to start with this error:

  ```text
  PDS_INTERNAL_URL is missing the http:// or https:// scheme: "core.railway.internal"
  ```

  Add the scheme and port explicitly. The canonical Docker Compose default (shown in `.env.example`) is `http://core:3000`; for Railway's private networking the equivalent is `http://<service>.railway.internal:<PDS_PORT>`, substituting whichever service name you gave your pds-core deployment and the `PDS_PORT` you configured on it. Railway's internal network uses plain HTTP on explicit ports, not HTTPS. This previously "worked" in the sense that the service started, but then failed on the first internal request; the new behaviour surfaces the misconfiguration immediately.

- <a id="v0.2.0-honour-the-generic-environment-variable-on-both-services-so"></a> [#27](https://github.com/hypercerts-org/ePDS/pull/27) Thanks [@aspiers](https://github.com/aspiers)! - Honour the generic `PORT` environment variable on both services, so Railway's automatic healthcheck succeeds without per-service configuration.

  **Affects:** Operators

  New port-resolution precedence (first set value wins):

  - **auth service:** `AUTH_PORT` → `PORT` → `3001`
  - **pds-core:** `PDS_PORT` → `PORT` → `3000` (pds-core reads `PDS_PORT`; when `PDS_PORT` is unset, `PORT` is copied into it before `@atproto/pds` reads its environment)

  If you run ePDS on Docker Compose or another orchestrator where you set `AUTH_PORT` / `PDS_PORT` explicitly: no change — your existing settings take precedence over `PORT`.

  If you run ePDS on Railway (or any platform that injects `PORT` automatically): you can now remove service-specific `AUTH_PORT` / `PDS_PORT` overrides from your Railway variables. Each service will pick up Railway's injected `PORT` and healthchecks will bind correctly. Previously these services bound to their hardcoded defaults regardless of `PORT`, causing Railway healthchecks to fail.
