#!/usr/bin/env bash
set -euo pipefail

MYSQL_ROOT="${HOME}/.local/mysql/current"
MYSQL_DATA="${HOME}/.local/mysql/data"
MYSQL_RUN="${HOME}/.local/mysql/run"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
APP_DB="${APP_DB:-typing_quiz_app}"
APP_USER="${APP_USER:-app}"
APP_PASS="${APP_PASS:-app_pw}"

if [[ ! -x "${MYSQL_ROOT}/bin/mysqld" ]]; then
  echo "MySQL binary not found at ${MYSQL_ROOT}/bin/mysqld"
  echo "Install first with:"
  echo "  mkdir -p ~/.local/mysql && cd ~/.local/mysql"
  echo "  curl -L https://downloads.mysql.com/archives/get/p/23/file/mysql-8.4.0-macos14-arm64.tar.gz -o mysql-8.4.0-macos14-arm64.tar.gz"
  echo "  tar -xzf mysql-8.4.0-macos14-arm64.tar.gz"
  echo "  ln -sfn ~/.local/mysql/mysql-8.4.0-macos14-arm64 ~/.local/mysql/current"
  exit 1
fi

mkdir -p "${MYSQL_DATA}" "${MYSQL_RUN}"

if [[ ! -d "${MYSQL_DATA}/mysql" ]]; then
  "${MYSQL_ROOT}/bin/mysqld" \
    --basedir="${MYSQL_ROOT}" \
    --datadir="${MYSQL_DATA}" \
    --initialize-insecure
fi

if lsof -nP -iTCP:"${MYSQL_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "MySQL already listening on ${MYSQL_HOST}:${MYSQL_PORT}"
else
  "${MYSQL_ROOT}/bin/mysqld" \
    --basedir="${MYSQL_ROOT}" \
    --datadir="${MYSQL_DATA}" \
    --port="${MYSQL_PORT}" \
    --bind-address="${MYSQL_HOST}" \
    --socket="${MYSQL_RUN}/mysql.sock" \
    --pid-file="${MYSQL_RUN}/mysql.pid" \
    --log-error="${MYSQL_RUN}/mysql.err" \
    --mysqlx=0 \
    --daemonize
fi

sleep 1

"${MYSQL_ROOT}/bin/mysql" -uroot --protocol=TCP -h"${MYSQL_HOST}" -P"${MYSQL_PORT}" <<SQL
CREATE DATABASE IF NOT EXISTS ${APP_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${APP_USER}'@'${MYSQL_HOST}' IDENTIFIED BY '${APP_PASS}';
ALTER USER '${APP_USER}'@'${MYSQL_HOST}' IDENTIFIED BY '${APP_PASS}';
GRANT ALL PRIVILEGES ON ${APP_DB}.* TO '${APP_USER}'@'${MYSQL_HOST}';
FLUSH PRIVILEGES;
SQL

echo "MySQL ready: ${MYSQL_HOST}:${MYSQL_PORT}"
echo "DB: ${APP_DB}, USER: ${APP_USER}"
