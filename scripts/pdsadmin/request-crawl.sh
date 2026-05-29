#!/usr/bin/env bash
set -o errexit
set -o nounset
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

RELAY_HOSTS="${1:-}"
if [[ "${RELAY_HOSTS}" == "" ]]; then
  RELAY_HOSTS="${PDS_CRAWLERS:-}"
fi

if [[ "${RELAY_HOSTS}" == "" ]]; then
  echo "ERROR: missing RELAY HOST parameter (and PDS_CRAWLERS is unset)." >/dev/stderr
  echo "Usage: pdsadmin request-crawl <RELAY HOST>[,<RELAY HOST>,...]" >/dev/stderr
  exit 1
fi

for host in ${RELAY_HOSTS//,/ }; do
  echo "Requesting crawl from ${host}"
  if [[ "${host}" != https:* && "${host}" != http:* ]]; then
    host="https://${host}"
  fi
  curl_cmd_post \
    --data "{\"hostname\": \"${PDS_HOSTNAME}\"}" \
    "${host}/xrpc/com.atproto.sync.requestCrawl" >/dev/null
done

echo "done"
