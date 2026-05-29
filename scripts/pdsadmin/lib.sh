#!/usr/bin/env bash
# Shared helpers for the ePDS pdsadmin scripts. Sourced, not executed.

# Load PDS_HOSTNAME / PDS_ADMIN_PASSWORD from the ePDS env file.
# Default path matches the dappnode deployment (/opt/epds/.env); override
# with PDS_ENV_FILE for local checkouts or other deployments.
PDS_ENV_FILE="${PDS_ENV_FILE:-/opt/epds/.env}"

if [[ ! -f "${PDS_ENV_FILE}" ]]; then
  echo "ERROR: env file not found: ${PDS_ENV_FILE}" >/dev/stderr
  echo "Set PDS_ENV_FILE to your ePDS .env (e.g. PDS_ENV_FILE=./.env)." >/dev/stderr
  exit 1
fi

# shellcheck disable=SC1090
set -o allexport
source "${PDS_ENV_FILE}"
set +o allexport

if [[ -z "${PDS_HOSTNAME:-}" || -z "${PDS_ADMIN_PASSWORD:-}" ]]; then
  echo "ERROR: PDS_HOSTNAME and PDS_ADMIN_PASSWORD must be set in ${PDS_ENV_FILE}." >/dev/stderr
  exit 1
fi

for bin in curl jq; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "ERROR: '${bin}' is required but not installed." >/dev/stderr
    exit 1
  fi
done

# curl a URL and fail if the request fails.
function curl_cmd_get {
  curl --fail --silent --show-error "$@"
}

# POST and fail if the request fails.
function curl_cmd_post {
  curl --fail --silent --show-error --request POST --header "Content-Type: application/json" "$@"
}

# POST but do not fail on non-2xx (so we can read the error body).
function curl_cmd_post_nofail {
  curl --silent --show-error --request POST --header "Content-Type: application/json" "$@"
}
