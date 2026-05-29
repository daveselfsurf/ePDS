#!/usr/bin/env bash
set -o errexit
set -o nounset
set -o pipefail

cat <<HELP
pdsadmin (ePDS) help
--
account
  list [--limit <N>]
    List accounts (created-at, handle, email, deactivated, DID),
    newest first. Reads the PDS account DB directly (via the pds-core
    container), so it includes accounts that listRepos omits and sorts
    by true creation time. Optional limit returns the N newest accounts.
    Requires Docker access (run with sudo). Override the container name
    with PDS_CORE_CONTAINER and DB path with PDS_ACCOUNT_DB if non-default.
    e.g. pdsadmin account list
    e.g. pdsadmin account list --limit 10
  create <EMAIL> <HANDLE>
    Create a new account with a random password.
    NOTE: bypasses ePDS OTP / community-DID provisioning.
    e.g. pdsadmin account create alice@example.com alice.example.com
  delete <DID>
    Delete an account specified by DID.
    e.g. pdsadmin account delete did:plc:xyz123abc456
  takedown <DID>
    Takedown an account specified by DID.
    e.g. pdsadmin account takedown did:plc:xyz123abc456
  untakedown <DID>
    Remove a takedown from an account specified by DID.
    e.g. pdsadmin account untakedown did:plc:xyz123abc456
  reset-password <DID>
    Reset the password for an account specified by DID.
    e.g. pdsadmin account reset-password did:plc:xyz123abc456

create-invite-code [<USE_COUNT>]
    Create a new invite code (default useCount 1).
    e.g. pdsadmin create-invite-code

request-crawl [<RELAY HOST>]
    Request a crawl from a relay host (defaults to PDS_CRAWLERS).
    e.g. pdsadmin request-crawl bsky.network

help
    Display this help information.

Config: reads PDS_HOSTNAME / PDS_ADMIN_PASSWORD from PDS_ENV_FILE
(default /opt/epds/.env). Override with PDS_ENV_FILE=./.env for local use.

There is no 'update' command: update ePDS via its docker compose build/up
flow, not the upstream pdsadmin updater.
HELP
