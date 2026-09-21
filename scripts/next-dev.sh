#!/usr/bin/env bash
# WSL 等で inotify の上限 (EMFILE) に達しやすいため、ポーリング監視を使う。
set -euo pipefail

export WATCHPACK_POLLING=true
export CHOKIDAR_USEPOLLING=true
export WATCHPACK_POLLING_INTERVAL=1000

# Supabaseの実値が無いworktreeでも、開発専用ログインから画面を確認できるようにする。
# シークレットは起動ごとに生成し、本番ではコード側でも必ず無効化する。
if [[ -z "${CI_LOGIN_BYPASS_SECRET:-}" ]]; then
    CI_LOGIN_BYPASS_SECRET="$(openssl rand -hex 32)"
    export CI_LOGIN_BYPASS_SECRET
fi
export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://local-placeholder.supabase.co}"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-local-placeholder}"

echo "- Tunnel:        https://asset-dev.minagu.work (要: cloudflared tunnel run dev-tunnel)"

exec next dev --webpack "$@"
