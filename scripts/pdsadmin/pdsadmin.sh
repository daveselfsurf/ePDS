#!/usr/bin/env bash
set -o errexit
set -o nounset
set -o pipefail

# ePDS-native pdsadmin dispatcher.
#
# Unlike the upstream Bluesky pdsadmin (which assumes the /pds docker-compose
# install and a /pds/pds.env file), this reads ePDS's .env and talks to the
# PDS purely over its public XRPC API. It therefore keeps working across repo
# changes: it depends only on PDS_HOSTNAME and PDS_ADMIN_PASSWORD plus stable
# AT Protocol lexicon endpoints, not on any code in this repo.
#
# The upstream "update" subcommand is intentionally NOT included: it pulls
# Bluesky's image and restarts via systemd, which would break ePDS's custom
# docker compose build/up flow. Update ePDS the normal way instead.
#
# Config: reads PDS_ENV_FILE (default /opt/epds/.env). Override for local/dev:
#   PDS_ENV_FILE=./.env ./scripts/pdsadmin/pdsadmin.sh account list

# Resolve symlinks so a symlink in e.g. /usr/local/bin/pdsadmin still finds
# its sibling scripts in the real scripts/pdsadmin/ directory.
SOURCE="${BASH_SOURCE[0]}"
while [[ -h "${SOURCE}" ]]; do
  DIR="$(cd -P "$(dirname "${SOURCE}")" && pwd)"
  SOURCE="$(readlink "${SOURCE}")"
  [[ "${SOURCE}" != /* ]] && SOURCE="${DIR}/${SOURCE}"
done
SCRIPT_DIR="$(cd -P "$(dirname "${SOURCE}")" && pwd)"

COMMAND="${1:-help}"
shift || true

case "${COMMAND}" in
  account)
    exec "${SCRIPT_DIR}/account.sh" "$@"
    ;;
  create-invite-code)
    exec "${SCRIPT_DIR}/create-invite-code.sh" "$@"
    ;;
  request-crawl)
    exec "${SCRIPT_DIR}/request-crawl.sh" "$@"
    ;;
  help | -h | --help)
    exec "${SCRIPT_DIR}/help.sh"
    ;;
  *)
    echo "Unknown command: ${COMMAND}" >/dev/stderr
    echo >/dev/stderr
    exec "${SCRIPT_DIR}/help.sh"
    ;;
esac
