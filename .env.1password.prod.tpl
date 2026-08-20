# 本番 DB を SSH トンネル経由でローカル接続する場合:
#   npm run prod:tunnel
DB_USER=op://apps/DB/db-user
DB_PASSWORD=op://apps/DB/db-password
DB_HOST=127.0.0.1
DB_PORT=3307
DB_NAME=op://apps/AssetManager/db-name
# 本番用Supabaseプロジェクトの Redirect URLs に、以下を追加しておくこと:
#   https://asset-dev.minagu.work/auth/callback （スマホ等LAN/Cloudflare Tunnel経由アクセス用）
NEXT_PUBLIC_SUPABASE_URL=op://apps/Supabase/project-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=op://apps/Supabase/publishable-key
NEXT_PUBLIC_GA_ID=op://apps/AssetManager/ga-id
SIGNALY_LOGIN_WEBHOOK_URL=op://apps/AssetManager/login-webhook-url
SIGNALY_REGISTER_WEBHOOK_URL=op://apps/AssetManager/register-webhook-url
SIGNALY_ZAIM_SYNC_WEBHOOK_URL=op://apps/AssetManager/zaim-sync-webhook-url
