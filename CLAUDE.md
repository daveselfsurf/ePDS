# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is ePDS?

ePDS (extended Personal Data Server) is a passwordless authentication layer for the AT Protocol. It wraps `@atproto/pds` with pluggable auth (email OTP, Google, GitHub), automatically provisioning AT Protocol accounts on first login. The auth flow: PAR request → PDS Core → Auth Service handles login → HMAC-signed callback → PDS creates account & issues OAuth tokens.

## Monorepo Layout

pnpm monorepo with three packages plus a demo:

| Package                       | Path                     | Purpose                                                             |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------- |
| `@certified-app/shared`       | `packages/shared/`       | SQLite DB (EpdsDb), crypto utils, logger, types                     |
| `@certified-app/auth-service` | `packages/auth-service/` | Login UI, OTP flows, social login, account settings (Express)       |
| `@certified-app/pds-core`     | `packages/pds-core/`     | Wraps `@atproto/pds` with `/oauth/epds-callback` endpoint (Express) |
| `@certified-app/demo`         | `packages/demo/`         | Next.js tutorial scaffold                                           |

## Commands

```bash
pnpm install                # install all deps
pnpm build                  # build all (tsc --build)
pnpm typecheck              # type-check without emit
pnpm dev                    # run all packages in dev/watch mode
pnpm dev:auth               # auth-service only
pnpm dev:pds                # pds-core only
pnpm dev:demo               # demo frontend (port 3002)
pnpm test                   # vitest run (all tests)
pnpm test:watch             # vitest watch mode
pnpm test:coverage          # vitest with coverage
pnpm lint                   # eslint
pnpm lint:fix               # eslint --fix
pnpm format                 # prettier --write
```

Run a single test file:

```bash
pnpm vitest run packages/auth-service/src/__tests__/login-page.test.ts
```

Run tests matching a pattern:

```bash
pnpm vitest run --reporter=verbose -t "creates an auth_flow"
```

Run tests for one package:

```bash
pnpm vitest run packages/shared
```

E2E tests (Cucumber + Playwright):

```bash
pnpm test:e2e:headless
```

## Critical Conventions

- **AGENTS.md** contains detailed coding standards, naming conventions, security rules, and gotchas. Read it before making significant changes.
- **TypeScript strict mode** — no implicit `any`. ES2022 target, Node16 module resolution.
- **ESM with `.js` extensions** — all imports of `.ts` files must use `.js` extension (Node16 requirement).
- **Type imports** — use `import type { Foo }` for type-only imports.
- **Named exports only** — no default exports (except Next.js pages).
- **Route pattern** — each route file exports a `create<Name>Router(ctx: AuthServiceContext): Router` factory.
- **Import order** — node built-ins (with `node:` prefix) → external → workspace (`@certified-app/*`) → local relative.
- **Database** — SQLite via `better-sqlite3`. All access through `EpdsDb`. Never touch `@atproto/pds` tables directly — use `pds.ctx.accountManager.*`.
- **Security** — HMAC-SHA256 signing for all callbacks (`signCallback`/`verifyCallback`). `timingSafeEqual()` for all secret comparisons. Escape user input with `escapeHtml()` in templates.
- **Testing** — tests live in `packages/<name>/src/__tests__/`. Read `docs/design/testing-gaps.md` before writing new tests. Ratchet coverage thresholds in `vitest.config.ts` after improvements.
- **Task tracking** — use `bd` (beads) tool, not TodoWrite or markdown files.

## Key Gotchas

- `docker compose restart` does NOT pick up `.env` changes — use `docker compose up -d`.
- `docker compose build --no-cache` is required (cache busting is broken).
- `better-auth` does NOT auto-migrate — `runBetterAuthMigrations()` must be called explicitly on startup.
- New PDS accounts need a real password (`randomBytes(32).toString('hex')`) — `undefined` breaks FK constraints.
- Auth service must use `PDS_INTERNAL_URL` for internal calls (Docker: `http://core:3000`), not the public URL.
