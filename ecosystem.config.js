module.exports = {
  apps: [
    {
      name: "asset-manager",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      // メモリ2GBのVPS上でNext.jsが10本常駐しており、Nodeの既定ヒープ上限
      // （1プロセスあたり約1006MB）ではGCが働かず各プロセスが数百MBを抱え込む。
      // 上限を明示して早めにGCさせる。max_memory_restart は暴走時の保険。
      // 詳細: https://github.com/guchi-apps/vps/issues/62
      node_args: "--max-old-space-size=128",
      max_memory_restart: "320M",
      env: {
        NODE_ENV: "development",
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3102,
      },
    },
    {
      name: "asset-manager-fetch-index-values",
      script: "npx",
      args: "-y tsx scripts/fetch-index-values.ts",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: false,
      cron_restart: "0 18 * * *",
      watch: false,
      env_production: {
        NODE_ENV: "production",
      },
    },
    {
      // Zaimのセッション維持のみ。評価額の取得は画面のボタンから行う。
      // 認証Cookieは2時間で失効し、アクセスのたびに2時間後へ延長されるため、
      // 1時間ごとに残高画面を1ページ開いて手動ログインなしで維持する。
      // ZAIM_BALANCE_URL 未設定の場合は何もせず終了する。
      name: "asset-manager-zaim-keep-alive",
      script: "node",
      // PM2のプロセスは .env を自動で読まないため、Node標準の機能で読み込ませる。
      // ファイルが無い環境でも起動できるよう -if-exists を使う。
      args: "--env-file-if-exists=.env scripts/zaim-keep-alive.mjs",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: false,
      cron_restart: "0 * * * *",
      watch: false,
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
