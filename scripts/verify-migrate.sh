#!/usr/bin/env bash
# 本番と同じ権限（app-migrator）で `prisma migrate deploy` を空DBへ流し、履歴を頭から全部適用する（#1637）。
# `verify:build`（db push・権限が広い）では見えない、権限不足のマイグレーション
# （例: CREATE TEMPORARY TABLES を使う #1630）をデプロイ前に失敗として見せる。
# 準備は初回のみ `npm run db:setup:migrate-verify`。権限の前提は docs/release-verification.md。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DB_USER="${MIGRATE_VERIFY_DB_USER:-am_migrator_verify}"
export DB_PASSWORD="${MIGRATE_VERIFY_DB_PASSWORD:-devpassword}"
export DB_HOST="${MIGRATE_VERIFY_DB_HOST:-127.0.0.1}"
export DB_PORT="${MIGRATE_VERIFY_DB_PORT:-3306}"
export DB_NAME="${MIGRATE_VERIFY_DB_NAME:-asset_manager_migrate_verify}"

# 全テーブルを消すので、検証用の命名のローカルDB以外では実行しない
if [[ ! "$DB_NAME" =~ _verify$ ]]; then
  echo "Error: DB名 '$DB_NAME' は検証用ではありません（*_verify のみ許可）。" >&2
  exit 1
fi
if [[ "$DB_HOST" != "127.0.0.1" && "$DB_HOST" != "localhost" ]]; then
  echo "Error: 検証DBはローカルのMySQLのみ使えます（DB_HOST=$DB_HOST）。" >&2
  exit 1
fi

MYSQL=(env MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME")
if ! "${MYSQL[@]}" -e "SELECT 1" >/dev/null 2>&1; then
  echo "Error: $DB_NAME に $DB_USER で接続できません。先に npm run db:setup:migrate-verify を実行してください。" >&2
  exit 1
fi

# 空のDBから始める（DROP DATABASE は本番権限に無いので、表だけ消す）
DROP_SQL="$("${MYSQL[@]}" -N -e "SELECT CONCAT('DROP TABLE IF EXISTS \`', TABLE_NAME, '\`;') FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()")"
if [[ -n "$DROP_SQL" ]]; then
  "${MYSQL[@]}" -e "SET FOREIGN_KEY_CHECKS=0; $DROP_SQL SET FOREIGN_KEY_CHECKS=1;"
fi

echo "== 本番相当の権限で prisma migrate deploy（空DBから全履歴）=="
bash scripts/construct-database-url.sh npx prisma migrate deploy
