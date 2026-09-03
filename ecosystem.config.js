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
      // 評価額のZaim自動取得。1日1回、AIDEが巡回し終えたキャッシュを読んで保存する。
      // 確認する人がいないため、スクリプト側の既定で「当日の評価額があれば上書きしない」
      // 「直近から±50%を超える値は保存しない」で動く。詳細は docs/zaim-auto-sync.md。
      // ZAIM_SYNC_USER_EMAIL / AIDE_READ_SECRET 未設定の場合は何もせず終了する。
      //
      // **AIDE側の巡回（サブPCの aide-zaim-sync.timer、23:35 JST）より後に動かす。**
      // 先に動くと前日のキャッシュを読んでしまう。
      name: "asset-manager-zaim-sync",
      script: "npx",
      // PM2のプロセスは .env を自動で読まないため、Nodeの --env-file-if-exists を
      // tsx経由で渡して読み込ませる（AIDE_READ_SECRET は .env にしか無い）。
      args: "-y tsx --env-file-if-exists=.env scripts/zaim-sync.ts",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: false,
      cron_restart: "50 23 * * *",
      watch: false,
      env_production: {
        NODE_ENV: "production",
      },
    },
    {
      // 積立（NISA・確定拠出年金）の入金の自動登録。評価額の増え方から入金日を選んで
      // DEPOSIT を1件作る。詳細は docs/specification.md「積立の自動登録」。
      //
      // **Zaim自動取得（23:50）より後に動かす。** その日の評価額が保存される前に判定すると、
      // 当日ぶんの増減を見ないまま月の判定を確定させてしまう。
      //
      // 判定は月に一度だけで、二重登録の防止はスクリプト側（RecurringDeposit の
      // lastProcessedMonth）が持つ。そのためデプロイ直後の1回起動でも何も起きない。
      name: "asset-manager-recurring-deposits",
      script: "npx",
      // PM2のプロセスは .env を自動で読まないため、Nodeの --env-file-if-exists を
      // tsx経由で渡して読み込ませる（通知先の SIGNALY_ZAIM_SYNC_WEBHOOK_URL は .env にしかない）。
      args: "-y tsx --env-file-if-exists=.env scripts/recurring-deposits.ts",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: false,
      cron_restart: "55 23 * * *",
      watch: false,
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
