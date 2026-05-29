#!/usr/bin/env bash
set -o errexit
set -o nounset
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

USE_COUNT="${1:-1}"

curl_cmd_post \
  --user "admin:${PDS_ADMIN_PASSWORD}" \
  --data "{\"useCount\": ${USE_COUNT}}" \
  "https://${PDS_HOSTNAME}/xrpc/com.atproto.server.createInviteCode" | jq --raw-output '.code'
