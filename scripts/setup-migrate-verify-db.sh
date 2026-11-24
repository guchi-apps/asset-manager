#!/usr/bin/env bash
# 本番のマイグレーション用ユーザー（app-migrator）と同じ権限だけを持つ検証用ユーザーと、
# 専用の空DBを作る（#1637）。初回のみ実行する。権限の根拠は docs/release-verification.md。
# Linux（subpc）は sudo mysql、macOS は `mysql -u root`（setup-verify-db.sh と同じ）。
set -euo pipefail

DB_NAME="${MIGRATE_VERIFY_DB_NAME:-asset_manager_migrate_verify}"
DB_USER="${MIGRATE_VERIFY_DB_USER:-am_migrator_verify}"
DB_PASSWORD="${MIGRATE_VERIFY_DB_PASSWORD:-devpassword}"

if [[ "$(uname -s)" == "Darwin" ]]; then
  MYSQL_ADMIN=(mysql -u root)
else
  MYSQL_ADMIN=(sudo mysql)
fi

# guchi-apps/vps の docs/web-stack.md「マイグレーション用アカウント」と同じ権限セット。
# CREATE TEMPORARY TABLES・TRIGGER・LOCK TABLES・CREATE VIEW・EXECUTE などは付けない。
GRANTS="SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES"

"${MYSQL_ADMIN[@]}" <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
-- 作り直しても権限が増えたまま残らないよう、いったん全部外してから付ける
REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${DB_USER}'@'localhost';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${DB_USER}'@'127.0.0.1';
GRANT ${GRANTS} ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
GRANT ${GRANTS} ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
echo "✅ マイグレーション検証DB ${DB_NAME}（ユーザー ${DB_USER}）を用意しました。確認: npm run verify:migrate"
