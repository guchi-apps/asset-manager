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
      //
      // **320Mへ下げ戻さない（#1151）。** 2GB時代の 128/320M のままでは、起動直後に約130MBの
      // プロセスが画面を数枚開くだけで350〜405MBに達し、PM2に数分おきに再起動されていた
      // （デプロイ後40分で7回。再起動の間はApacheが「Service Unavailable」を返す）。
      // VPSは4GBへ増強済み（guchi-apps/vps#118）なので、issue-deck（256/768M）と同程度まで上げる。
      // 調べ方と実測値は docs/production-memory.md。
      //
      // --max-semi-space-size=8 は若い世代の上限。既定（ヒープ量に応じて16〜64MB）より小さくして、
      // 短命なオブジェクトを早めに回収させる（issue-deckではヒープが195→85MBになった。#1226）。
      node_args: "--max-old-space-size=256 --max-semi-space-size=8",
      max_memory_restart: "640M",
      env: {
        NODE_ENV: "development",
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3102,
        // Prismaのクエリエンジン（Rust・tokioのワーカースレッド）などがスレッドごとにglibcの
        // mallocアリーナ（1つあたり最大64MBの予約）を作り、ヒープ外のRSSを押し上げるのを抑える（#1226）。
        // 効いているかは /proc/<pid>/environ で確かめる（docs/production-memory.md）。
        MALLOC_ARENA_MAX: "2",
      },
    },
    {
      // 定時のバッチは node を直接起動し、tsx はローダーとして読み込む（#1226）。
      // 以前の `npx -y tsx …` は npm・tsx のCLI・子のnode・sh の4プロセスになり、1回あたり
      // 約260MB（ローカル実測）を使っていた。`node --import tsx` なら1プロセス・約110MB。
      // node は実行ファイルなので interpreter: "none" を付ける（付けないとPM2が node で node を起動する）。
      // 本番は `npm ci --omit=dev` のため、tsx は dependencies に置いている。
      name: "asset-manager-fetch-index-values",
      script: "node",
      interpreter: "none",
      args: "--import tsx scripts/fetch-index-values.ts",
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
      script: "node",
      interpreter: "none",
      // PM2のプロセスは .env を自動で読まないため、Nodeの --env-file-if-exists を
      // 渡して読み込ませる（AIDE_READ_SECRET は .env にしか無い）。
      args: "--import tsx --env-file-if-exists=.env scripts/zaim-sync.ts",
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
      script: "node",
      interpreter: "none",
      // PM2のプロセスは .env を自動で読まないため、Nodeの --env-file-if-exists を
      // 渡して読み込ませる（通知先の DISCORD_ALERT_WEBHOOK_URL は .env にしかない）。
      args: "--import tsx --env-file-if-exists=.env scripts/recurring-deposits.ts",
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
    {
      // 家計簿の明細の取り込み（Issue #817）。AIDEのZaim明細の巡回（サブPC、11:30・23:30）が
      // 終わったキャッシュを読み、家計簿の取引へ反映する。取り込み開始日を画面で保存するまでは何もしない。
      // 二重取り込みの防止はZaimの明細id（LedgerSourceRecord）で行うので、デプロイ直後の1回起動でも増えない。
      name: "asset-manager-ledger-sync",
      script: "node",
      interpreter: "none",
      args: "--import tsx --env-file-if-exists=.env scripts/ledger-sync.ts",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: false,
      cron_restart: "52 11,23 * * *",
      watch: false,
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
