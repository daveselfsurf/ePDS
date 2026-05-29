---
'ePDS': patch
---

Add an ePDS-native `pdsadmin` CLI under `scripts/pdsadmin/`, so operators get the familiar Bluesky `pdsadmin` admin commands against an ePDS deployment.

**Affects:** ePDS operators

The upstream Bluesky `pdsadmin` script is not bundled with ePDS and assumes the `/pds` docker-compose layout (`/pds/pds.env`, a container named `pds`, systemd-based `update`), so running `./pdsadmin …` on an ePDS box fails with `command not found`. This adds a wrapper that talks to the PDS purely over its public XRPC API and reads ePDS's own env file.

- `scripts/pdsadmin/pdsadmin.sh` dispatches `account {list,create,delete,takedown,untakedown,reset-password}`, `create-invite-code [useCount]`, `request-crawl [relay]`, and `help`.
- Reads `PDS_HOSTNAME` / `PDS_ADMIN_PASSWORD` from `PDS_ENV_FILE` (default `/opt/epds/.env`; override with `PDS_ENV_FILE=./.env` for local use).
- The upstream `update` subcommand is intentionally omitted — it pulls Bluesky's image and restarts via systemd, which would break ePDS's `docker compose build/up` flow. Update ePDS the normal way.
- Because it depends only on stable AT Protocol lexicon endpoints plus those two core env vars (not on any package code), it keeps working across future repo changes.

Usage on the server:

```bash
sudo /opt/epds/scripts/pdsadmin/pdsadmin.sh account list
```
