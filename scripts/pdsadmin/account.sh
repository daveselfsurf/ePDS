#!/usr/bin/env bash
set -o errexit
set -o nounset
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

SUBCOMMAND="${1:-}"

#
# account list
#
if [[ "${SUBCOMMAND}" == "list" ]]; then
  # Optional limit: "account list 10" or "account list --limit 10" returns
  # the N most recently created accounts.
  LIMIT=""
  if [[ "${2:-}" == "--limit" ]]; then
    LIMIT="${3:-}"
  elif [[ "${2:-}" =~ ^[0-9]+$ ]]; then
    LIMIT="${2}"
  fi
  if [[ -n "${LIMIT}" && ! "${LIMIT}" =~ ^[0-9]+$ ]]; then
    echo "ERROR: limit must be a positive integer." >/dev/stderr
    echo "Usage: pdsadmin account list [--limit <N>]" >/dev/stderr
    exit 1
  fi

  # Read the PDS account DB directly rather than via com.atproto.sync.listRepos.
  # listRepos inner-joins repo_root and filters by account status, so it omits
  # accounts with no repo yet or that are deactivated, and it exposes only an
  # indexedAt (re-index time) — not creation time. The actor table has the
  # authoritative createdAt for every account.
  #
  # The DB lives inside the pds-core container (WAL mode), so we query it there
  # rather than copying the file out and risking missing un-checkpointed data.
  PDS_CORE_CONTAINER="${PDS_CORE_CONTAINER:-epds-core}"
  PDS_ACCOUNT_DB="${PDS_ACCOUNT_DB:-/data/account.sqlite}"

  SQL="SELECT actor.createdAt, actor.handle, account.email, actor.deactivatedAt, actor.did
       FROM actor
       LEFT JOIN account ON account.did = actor.did
       ORDER BY actor.createdAt DESC"
  if [[ -n "${LIMIT}" ]]; then
    SQL="${SQL} LIMIT ${LIMIT}"
  fi
  SQL="${SQL};"

  # sqlite3 isn't in the node:alpine image by default; install it ephemerally
  # if missing, then run a read-only query. Use a real tab as the column
  # separator: we pass it through a $TAB env var (a literal tab from printf)
  # because a "\t" inside the double-quoted sh -c would stay backslash-t.
  TAB="$(printf '\t')"
  ROWS="$(docker exec -e "TAB=${TAB}" "${PDS_CORE_CONTAINER}" sh -c "
    command -v sqlite3 >/dev/null 2>&1 || apk add --no-cache sqlite >/dev/null 2>&1
    sqlite3 -readonly -noheader -separator \"\$TAB\" '${PDS_ACCOUNT_DB}' \"${SQL}\"
  ")"

  # Format as an aligned table with awk (more portable than column --separator,
  # whose tab handling differs across implementations). Two passes over the
  # data held in a flat cell[] array (no gawk-only 2D arrays): substitute "-"
  # for blank fields, measure column widths, then left-pad each cell.
  printf 'Created\tHandle\tEmail\tDeactivated\tDID\n%s\n' "${ROWS}" \
    | awk -F'\t' '
        { nf[NR] = NF
          for (i = 1; i <= NF; i++) {
            v = ($i == "") ? "-" : $i
            cell[NR SUBSEP i] = v
            if (length(v) > w[i]) w[i] = length(v)
          }
        }
        END {
          for (r = 1; r <= NR; r++) {
            line = ""
            for (i = 1; i <= nf[r]; i++) {
              c = cell[r SUBSEP i]
              line = line c
              if (i < nf[r]) { pad = w[i] - length(c) + 2; while (pad-- > 0) line = line " " }
            }
            print line
          }
        }'

#
# account create
#
elif [[ "${SUBCOMMAND}" == "create" ]]; then
  EMAIL="${2:-}"
  HANDLE="${3:-}"

  if [[ "${EMAIL}" == "" ]]; then
    read -r -p "Enter an email address (e.g. alice@${PDS_HOSTNAME}): " EMAIL
  fi
  if [[ "${HANDLE}" == "" ]]; then
    read -r -p "Enter a handle (e.g. alice.${PDS_HOSTNAME}): " HANDLE
  fi

  if [[ "${EMAIL}" == "" || "${HANDLE}" == "" ]]; then
    echo "ERROR: missing EMAIL and/or HANDLE parameters." >/dev/stderr
    echo "Usage: pdsadmin account ${SUBCOMMAND} <EMAIL> <HANDLE>" >/dev/stderr
    exit 1
  fi

  PASSWORD="$(openssl rand -base64 30 | tr -d "=+/" | cut -c1-24)"
  INVITE_CODE="$(curl_cmd_post \
    --user "admin:${PDS_ADMIN_PASSWORD}" \
    --data '{"useCount": 1}' \
    "https://${PDS_HOSTNAME}/xrpc/com.atproto.server.createInviteCode" | jq --raw-output '.code'
  )"
  RESULT="$(curl_cmd_post_nofail \
    --data "{\"email\":\"${EMAIL}\", \"handle\":\"${HANDLE}\", \"password\":\"${PASSWORD}\", \"inviteCode\":\"${INVITE_CODE}\"}" \
    "https://${PDS_HOSTNAME}/xrpc/com.atproto.server.createAccount"
  )"

  DID="$(echo "${RESULT}" | jq --raw-output '.did')"
  if [[ "${DID}" != did:* ]]; then
    ERR="$(echo "${RESULT}" | jq --raw-output '.message')"
    echo "ERROR: ${ERR}" >/dev/stderr
    echo "Usage: pdsadmin account ${SUBCOMMAND} <EMAIL> <HANDLE>" >/dev/stderr
    exit 1
  fi

  echo
  echo "Account created successfully!"
  echo "-----------------------------"
  echo "Handle   : ${HANDLE}"
  echo "DID      : ${DID}"
  echo "Password : ${PASSWORD}"
  echo "-----------------------------"
  echo "Save this password, it will not be displayed again."
  echo

#
# account delete
#
elif [[ "${SUBCOMMAND}" == "delete" ]]; then
  DID="${2:-}"

  if [[ "${DID}" == "" ]]; then
    echo "ERROR: missing DID parameter." >/dev/stderr
    echo "Usage: pdsadmin account ${SUBCOMMAND} <DID>" >/dev/stderr
    exit 1
  fi

  if [[ "${DID}" != did:* ]]; then
    echo "ERROR: DID parameter must start with \"did:\"." >/dev/stderr
    echo "Usage: pdsadmin account ${SUBCOMMAND} <DID>" >/dev/stderr
    exit 1
  fi

  echo "This action is permanent."
  read -r -p "Are you sure you'd like to delete ${DID}? [y/N] " response
  if [[ ! "${response}" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    exit 0
  fi

  curl_cmd_post \
    --user "admin:${PDS_ADMIN_PASSWORD}" \
    --data "{\"did\": \"${DID}\"}" \
    "https://${PDS_HOSTNAME}/xrpc/com.atproto.admin.deleteAccount" >/dev/null

  echo "${DID} deleted"

#
# account takedown
#
elif [[ "${SUBCOMMAND}" == "takedown" ]]; then
  DID="${2:-}"
  TAKEDOWN_REF="$(date +%s)"

  if [[ "${DID}" == "" ]]; then
    echo "ERROR: missing DID parameter." >/dev/stderr
    echo "Usage: pdsadmin account ${SUBCOMMAND} <DID>" >/dev/stderr
    exit 1
  fi

  if [[ "${DID}" != did:* ]]; then
    echo "ERROR: DID parameter must start with \"did:\"." >/dev/stderr
    echo "Usage: pdsadmin account ${SUBCOMMAND} <DID>" >/dev/stderr
    exit 1
  fi

  PAYLOAD="$(cat <<EOF
    {
      "subject": {
        "\$type": "com.atproto.admin.defs#repoRef",
        "did": "${DID}"
      },
      "takedown": {
        "applied": true,
        "ref": "${TAKEDOWN_REF}"
      }
    }
EOF
)"

  curl_cmd_post \
    --user "admin:${PDS_ADMIN_PASSWORD}" \
    --data "${PAYLOAD}" \
    "https://${PDS_HOSTNAME}/xrpc/com.atproto.admin.updateSubjectStatus" >/dev/null

  echo "${DID} taken down"

#
# account untakedown
#
elif [[ "${SUBCOMMAND}" == "untakedown" ]]; then
  DID="${2:-}"

  if [[ "${DID}" == "" ]]; then
    echo "ERROR: missing DID parameter." >/dev/stderr
    echo "Usage: pdsadmin account ${SUBCOMMAND} <DID>" >/dev/stderr
    exit 1
  fi

  if [[ "${DID}" != did:* ]]; then
    echo "ERROR: DID parameter must start with \"did:\"." >/dev/stderr
    echo "Usage: pdsadmin account ${SUBCOMMAND} <DID>" >/dev/stderr
    exit 1
  fi

  PAYLOAD="$(cat <<EOF
  {
    "subject": {
      "\$type": "com.atproto.admin.defs#repoRef",
      "did": "${DID}"
    },
    "takedown": {
      "applied": false
    }
  }
EOF
)"

  curl_cmd_post \
    --user "admin:${PDS_ADMIN_PASSWORD}" \
    --data "${PAYLOAD}" \
    "https://${PDS_HOSTNAME}/xrpc/com.atproto.admin.updateSubjectStatus" >/dev/null

  echo "${DID} untaken down"

#
# account reset-password
#
elif [[ "${SUBCOMMAND}" == "reset-password" ]]; then
  DID="${2:-}"
  PASSWORD="$(openssl rand -base64 30 | tr -d "=+/" | cut -c1-24)"

  if [[ "${DID}" == "" ]]; then
    echo "ERROR: missing DID parameter." >/dev/stderr
    echo "Usage: pdsadmin account ${SUBCOMMAND} <DID>" >/dev/stderr
    exit 1
  fi

  if [[ "${DID}" != did:* ]]; then
    echo "ERROR: DID parameter must start with \"did:\"." >/dev/stderr
    echo "Usage: pdsadmin account ${SUBCOMMAND} <DID>" >/dev/stderr
    exit 1
  fi

  curl_cmd_post \
    --user "admin:${PDS_ADMIN_PASSWORD}" \
    --data "{ \"did\": \"${DID}\", \"password\": \"${PASSWORD}\" }" \
    "https://${PDS_HOSTNAME}/xrpc/com.atproto.admin.updateAccountPassword" >/dev/null

  echo
  echo "Password reset for ${DID}"
  echo "New password: ${PASSWORD}"
  echo

else
  echo "Unknown account subcommand: ${SUBCOMMAND:-(none)}" >/dev/stderr
  echo "Valid: list, create, delete, takedown, untakedown, reset-password" >/dev/stderr
  exit 1
fi
