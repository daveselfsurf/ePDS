# Configuration

Each package has its own `.env.example` documenting the variables it reads:

- [`packages/pds-core/.env.example`](../packages/pds-core/.env.example)
- [`packages/auth-service/.env.example`](../packages/auth-service/.env.example)
- [`packages/demo/.env.example`](../packages/demo/.env.example)

For quick local setup, run `./scripts/setup.sh` — it copies the top-level
`.env.example` to `.env` and auto-generates all secrets.

## Deployment contexts

| Context             | How vars are loaded                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| **docker-compose**  | Loads the top-level `.env` via `env_file` for core, auth, and caddy.                                          |
| **Railway**         | Set per-service in the dashboard. Use shared variable groups for `[shared]` vars.                             |
| **`pnpm dev`**      | `dotenv.config()` in pds-core loads the top-level `.env`. Auth-service inherits the same process environment. |
| **`pnpm dev:demo`** | Next.js loads `packages/demo/.env` automatically.                                                             |

## Shared variables

These must have **identical values** in pds-core and auth-service. They are
marked `[shared]` in the per-package `.env.example` files.

| Variable               | Description                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `PDS_HOSTNAME`         | Your PDS domain — handles will be `<random>.PDS_HOSTNAME`                                               |
| `PDS_PUBLIC_URL`       | Full public URL of the PDS, used as OAuth issuer (e.g. `https://pds.example.com`)                       |
| `EPDS_CALLBACK_SECRET` | HMAC-SHA256 secret signing the `/oauth/epds-callback` redirect — generate with `openssl rand -hex 32`   |
| `EPDS_INTERNAL_SECRET` | Shared secret for internal service-to-service calls (auth → PDS) — generate with `openssl rand -hex 32` |
| `PDS_ADMIN_PASSWORD`   | PDS admin API password (auth-service uses it for account provisioning)                                  |
| `NODE_ENV`             | Set to `development` for dev mode (disables secure cookies)                                             |

## PDS Core

| Variable                                    | Description                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `PDS_PORT`                                  | Port for PDS Core (default `3000`)                                                               |
| `PDS_DATA_DIRECTORY`                        | Path to data directory (default `/data`)                                                         |
| `PDS_DID_PLC_URL`                           | AT Protocol PLC directory URL (default `https://plc.directory`)                                  |
| `PDS_BSKY_APP_VIEW_URL`                     | Bluesky app view URL (default `https://api.bsky.app`)                                            |
| `PDS_BSKY_APP_VIEW_DID`                     | Bluesky app view DID (default `did:web:api.bsky.app`)                                            |
| `PDS_CRAWLERS`                              | AT Protocol crawlers (default `https://bsky.network`)                                            |
| `PDS_JWT_SECRET`                            | Secret for JWT signing — generate with `openssl rand -hex 32`                                    |
| `PDS_DPOP_SECRET`                           | Secret for DPoP — generate with `openssl rand -hex 32`                                           |
| `PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX` | secp256k1 private key for PLC rotation — see [deployment.md](deployment.md)                      |
| `PDS_EMAIL_SMTP_URL`                        | SMTP URL (e.g. `smtps://user:pass@smtp.resend.com:465`)                                          |
| `PDS_EMAIL_FROM_ADDRESS`                    | Sender address for PDS emails                                                                    |
| `PDS_BLOBSTORE_DISK_LOCATION`               | Path to blob storage directory (default `/data/blobs`)                                           |
| `EPDS_INVITE_CODE`                          | Pre-generated invite code for account creation (see [deployment.md](deployment.md#invite-codes)) |
| `PDS_INVITE_REQUIRED`                       | Whether invite codes are required for account creation (default `true`)                          |

Optional PDS email variables:

| Variable                        | Description                                      |
| ------------------------------- | ------------------------------------------------ |
| `PDS_CONTACT_EMAIL_ADDRESS`     | Contact address shown in PDS well-known metadata |
| `PDS_MODERATION_EMAIL_SMTP_URL` | Separate SMTP for moderation reports             |
| `PDS_MODERATION_EMAIL_ADDRESS`  | Moderation report address                        |

## Auth Service

| Variable              | Description                                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_HOSTNAME`       | Auth subdomain (e.g. `auth.pds.example.com`) — must be a subdomain of `PDS_HOSTNAME`                                                                                                                        |
| `AUTH_PORT`           | Port for Auth Service (default `3001`)                                                                                                                                                                      |
| `AUTH_SESSION_SECRET` | Session secret — generate with `openssl rand -hex 32`                                                                                                                                                       |
| `AUTH_CSRF_SECRET`    | CSRF secret — generate with `openssl rand -hex 32`                                                                                                                                                          |
| `PDS_INTERNAL_URL`    | **Required.** Internal URL for auth→PDS calls. Docker: `http://core:3000`; Railway: `http://<service>.railway.internal:3000`; local dev: `http://localhost:3000`. Auth service crashes at startup if unset. |

### Verification link settings

| Variable                   | Description                                                |
| -------------------------- | ---------------------------------------------------------- |
| `EPDS_LINK_EXPIRY_MINUTES` | Link expiry in minutes (default `10`)                      |
| `EPDS_LINK_BASE_URL`       | Base URL for verification links — must match AUTH_HOSTNAME |

### Better Auth session

| Variable             | Description                                             |
| -------------------- | ------------------------------------------------------- |
| `SESSION_EXPIRES_IN` | Session lifetime in seconds (default `604800` = 7 days) |
| `SESSION_UPDATE_AGE` | Session update age in seconds (default `86400` = 1 day) |

### Social providers (optional)

Both ID and SECRET must be set to enable a provider. When set, social login
buttons appear on the login page.

| Variable               | Description                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | Google OAuth client ID — [Google Cloud Console](https://console.cloud.google.com/)           |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret                                                                   |
| `GITHUB_CLIENT_ID`     | GitHub OAuth client ID — [GitHub Developer Settings](https://github.com/settings/developers) |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret                                                                   |

### Email

| Variable                | Description                                                         |
| ----------------------- | ------------------------------------------------------------------- |
| `EMAIL_PROVIDER`        | Provider: `smtp`, `sendgrid`, `ses`, or `postmark` (default `smtp`) |
| `SMTP_HOST`             | SMTP hostname (e.g. `smtp.resend.com`)                              |
| `SMTP_PORT`             | SMTP port (e.g. `465`)                                              |
| `SMTP_USER`             | SMTP username                                                       |
| `SMTP_PASS`             | SMTP password / API key                                             |
| `SMTP_FROM`             | Sender address — must be on a verified domain                       |
| `SMTP_FROM_NAME`        | Sender display name                                                 |
| `SENDGRID_API_KEY`      | SendGrid API key (for `EMAIL_PROVIDER=sendgrid`)                    |
| `AWS_REGION`            | AWS region for SES (default `us-east-1`)                            |
| `AWS_SES_SMTP_USER`     | AWS SES SMTP username                                               |
| `AWS_SES_SMTP_PASS`     | AWS SES SMTP password                                               |
| `POSTMARK_SERVER_TOKEN` | Postmark server token                                               |

### Database

| Variable      | Description                                                    |
| ------------- | -------------------------------------------------------------- |
| `DB_LOCATION` | Path to the ePDS SQLite database (default `/data/epds.sqlite`) |

## Demo

The demo is standalone — it does not share variables with pds-core or
auth-service.

| Variable         | Description                                                                          |
| ---------------- | ------------------------------------------------------------------------------------ |
| `PUBLIC_URL`     | Public URL of the demo app (used for OAuth `client_id` and `redirect_uri`)           |
| `PDS_URL`        | URL of the ePDS instance to authenticate against                                     |
| `AUTH_ENDPOINT`  | Auth service's OAuth authorize URL (e.g. `https://auth.pds.example/oauth/authorize`) |
| `SESSION_SECRET` | Session signing secret — generate with `openssl rand -base64 32`                     |

Optional:

| Variable            | Description                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| `PLC_DIRECTORY_URL` | PLC directory for DID-to-handle resolution (default `https://plc.directory`) |

## Docker / Caddy

| Variable        | Description                                                |
| --------------- | ---------------------------------------------------------- |
| `PDS_UPSTREAM`  | Override PDS reverse proxy upstream (default `core:3000`)  |
| `AUTH_UPSTREAM` | Override auth reverse proxy upstream (default `auth:3001`) |

## Runtime

| Variable       | Description                    |
| -------------- | ------------------------------ |
| `PDS_DEV_MODE` | Set to `true` for PDS dev mode |
