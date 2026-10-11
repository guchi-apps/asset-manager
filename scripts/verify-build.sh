#!/usr/bin/env bash
# リリース検証用: CIの「Database schema sync → Build check」と同じ手順をサブPCで再現する。
#
# 専用の検証DB（既定 asset_manager_verify）へ `prisma db push --accept-data-loss` で
# スキーマを入れ、`npm run build`（ラッパー無し）を実行する。.env も1Passwordも要らない。
# 接続情報は環境変数 VERIFY_DB_* で上書きできる（実値はリポジトリへ置かない）。
#
# `--accept-data-loss` は中身を壊すため、誤って開発DB・本番DBへ向けないよう
# DB名が検証用の命名（*_verify / am_ci_shadow）でなければ実行を拒否する。
# DBの作成は `npm run db:setup:verify`（初回のみ・sudo が必要）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export DB_USER="${VERIFY_DB_USER:-asset_manager}"
export DB_PASSWORD="${VERIFY_DB_PASSWORD:-devpassword}"
export DB_HOST="${VERIFY_DB_HOST:-127.0.0.1}"
export DB_PORT="${VERIFY_DB_PORT:-3306}"
export DB_NAME="${VERIFY_DB_NAME:-asset_manager_verify}"

# 既定の検証DBが未作成（作成にはsudoが要る）で、VERIFY_DB_NAME の明示も無いときは、
# 権限付与済みの既存シャドウDB am_ci_shadow へ切り替える（#704）。
if [[ -z "${VERIFY_DB_NAME:-}" ]] && command -v mysql >/dev/null 2>&1; then
  if ! MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
      -e "USE \`$DB_NAME\`" >/dev/null 2>&1 \
    && MYSQL_PWD="$DB_PASSWORD" mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
      -e "USE am_ci_shadow" >/dev/null 2>&1; then
    echo "Note: $DB_NAME が無いため am_ci_shadow を使います。" >&2
    DB_NAME=am_ci_shadow
    export DB_NAME
  fi
fi

if [[ ! "$DB_NAME" =~ (_verify$|^am_ci_shadow$) ]]; then
  echo "Error: DB名 '$DB_NAME' は検証用ではありません（*_verify のみ許可）。" >&2
  exit 1
fi
if [[ "$DB_HOST" != "127.0.0.1" && "$DB_HOST" != "localhost" ]]; then
  echo "Error: 検証DBはローカルのMySQLのみ使えます（DB_HOST=$DB_HOST）。" >&2
  exit 1
fi

# Next.js のビルドがSupabaseクライアントを作るため、CIと同様に空値で通せるか確認済みの
# 場合を除き、未設定ならプレースホルダーを補う（実接続はしない）。
export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://placeholder.supabase.co}"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-placeholder-key}"

exec bash scripts/construct-database-url.sh bash -c '
  set -euo pipefail
  npx prisma db push --accept-data-loss
  npm run build
'
