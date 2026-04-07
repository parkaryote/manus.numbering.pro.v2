#!/usr/bin/env bash
set -euo pipefail

MYSQL_ROOT="${HOME}/.local/mysql/current"
MYSQL_RUN="${HOME}/.local/mysql/run"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"

if [[ -f "${MYSQL_RUN}/mysql.pid" ]]; then
  PID="$(cat "${MYSQL_RUN}/mysql.pid")"
  if kill -0 "${PID}" >/dev/null 2>&1; then
    kill "${PID}"
    echo "Stopped MySQL process ${PID}"
    exit 0
  fi
fi

if [[ -x "${MYSQL_ROOT}/bin/mysqladmin" ]]; then
  if "${MYSQL_ROOT}/bin/mysqladmin" -uroot --protocol=TCP -h"${MYSQL_HOST}" -P"${MYSQL_PORT}" shutdown >/dev/null 2>&1; then
    echo "Stopped MySQL via mysqladmin"
    exit 0
  fi
fi

echo "No running MySQL instance found."
