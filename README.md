# asset-manager (資産管理アプリケーション)

ポートフォリオの推移と構成を、美しく直感的に管理する資産管理トラッカーです。Next.js (App Router)、Prisma、Tailwind CSS を使用して構築されています。

## 主な機能

- 📊 **ダッシュボード**
  - 総資産、負債、純資産、利益・損益率のサマリー表示
  - アセット構成（円グラフ等）と資産推移（折れ線グラフ）の可視化
  - 資産カテゴリ別の内訳リスト表示

- 💰 **資産・カテゴリ管理**
  - アセット（現金、投資商品、負債など）の自由なカテゴリ分け
  - カスタムタグによる多角的な分類管理
  - 資産ごとの取引（入出金・売買）と評価額の記録・編集（資産詳細画面）

- 🔄 **評価額の自動取得**
  - AIDE経由でZaimの残高・保有銘柄を毎晩取り込み、カテゴリごとの評価額へ反映
  - 反映・見送り・未対応を「データ取得状況」画面で確認し、対応付けの設定と再取り込みもここから行う
  - 詳細は [docs/zaim-auto-sync.md](docs/zaim-auto-sync.md)

- 🧾 **家計簿連携（Zaim）**
  - スマートレシート・Amazon・Gmailから明細を取り込み、AIで構造化して確認・修正
  - Zaim全体の「内訳が決まっていない支出」を集め、分類履歴とAIで内訳を提案してまとめて反映
  - 「商品名 → Zaimの内訳」の対応履歴を貯め、次回からAI判断より優先
  - 口座間コピーのルールを登録し、明細をコピー先口座へ複製（複製済みは二度登録しない）
  - 確定した明細を請求元のクレジットカードへ商品ごとに登録（AIDE経由のZaim Web版入力）し、Zaimアプリでの「置き換え」に載せる
  - 詳細は [docs/receipt-import.md](docs/receipt-import.md)

- 🔐 **認証・セキュリティ (Supabase Auth)**
  - Google OAuth ログイン対応

- 🎨 **カスタマイズ可能なUI**
  - ダークモード / ライトモード対応
  - レスポンシブデザインによるモバイル表示対応

---

## 開発環境のセットアップ

### 構成の概要

| 環境 | DB | 用途 |
|------|-----|------|
| ローカル（WSL） | `127.0.0.1:3306` / `asset_manager_dev` | 日常開発 |
| 本番（VPS） | 1Password の `db-host` / `db-name` | 本番運用 |
| 本番（ローカル接続） | SSH トンネル `127.0.0.1:3307` | デバッグ用（`prod:tunnel`） |

VPS 上の dev DB は使いません。ローカル開発は WSL 内の MySQL のみで完結します。

### 前提条件

- Node.js 20 系
- WSL 内の MySQL 8.0（`sudo apt install mysql-server`）

> Docker Desktop は不要です。WSL 連携が使える環境では `npm run db:up:docker` で Docker 版も利用できます。
>
> 1Password CLI は日常のローカル開発では不要です。本番デプロイの確認や本番 DB への接続（[本番 DB のローカル接続](#本番-db-のローカル接続デバッグ用)）でのみ使用します。インストール手順は[デプロイ方法](#-デプロイ方法-github-actions-経由)を参照してください。

### 初回セットアップ

```bash
# パッケージのインストール
npm install

# ローカル開発用の環境変数ファイルを作成（1Password 不要）
cp .env.local.example .env.local

# MySQL が未インストールの場合（初回のみ）
sudo apt update && sudo apt install -y mysql-server

# ローカル MySQL 起動 + スキーマ適用（初回のみ、sudo パスワード入力あり）
npm run db:setup

# 開発サーバーの起動
npm run dev
```

`.env.local` の Signaly 通知欄は空のままでも起動できます（未設定なら通知をスキップします）。ただし Google OAuth はログインに必須のため、[Google ログイン（ローカル開発）](#google-ログインローカル開発) の手順で設定してください。

日常の開発では `npm run db:up` で MySQL を起動してから `npm run dev` を実行します（`db:setup` は初回または DB を作り直したときのみ）。

#### Claude Code など非対話環境での初回セットアップ

`npm run db:up` / `npm run db:setup` は内部で `sudo service mysql start` 等を実行するため、通常は sudo パスワードの入力を求められます。Claude Code のような非対話環境ではパスワード入力ができず失敗するので、事前に一度だけ以下を対話シェルで実行し、MySQL 起動系コマンドのみパスワードなしで sudo できるようにしておきます。

```bash
npm run db:setup:sudoers
```

これは `/etc/sudoers.d/mysql-dev-nopasswd` に `service mysql start/stop` と `mysqladmin ping` / `mysql`（DB・ユーザー作成用）に限定した NOPASSWD ルールを追加します（他のコマンドの sudo は従来どおりパスワードが必要です）。設定後は非対話環境からでも `npm run db:up` / `npm run db:setup` が動作します。

### ローカル DB コマンド

| コマンド | 1Password | 内容 |
|---------|-----------|------|
| `npm run db:up` | 不要 | WSL MySQL を起動（`127.0.0.1:3306`） |
| `npm run db:up:docker` | 不要 | Docker で MySQL 8.0 を起動（`127.0.0.1:3308`） |
| `npm run db:down` | 不要 | ローカル MySQL を停止 |
| `npm run db:status` | 不要 | MySQL の状態確認 |
| `npm run db:setup` | 不要 | 起動 + `prisma db push`（初回用） |
| `npm run db:deploy:local` | 不要 | `schema.prisma` をローカル DB に反映 |
| `npm run db:reset` | 不要 | DB を初期化してスキーマを再適用 |
| `npm run db:dev` | 不要 | マイグレーションファイルの作成（スキーマ変更時） |
| `npm run dev` | 不要 | 開発サーバー起動（`.env.local` を使用） |

ローカル DB の接続情報（`.env.local.example` に記載、秘密情報ではない）:

| 項目 | 値 |
|------|-----|
| ホスト | `127.0.0.1` |
| ポート | `3306` |
| DB 名 | `asset_manager_dev` |
| ユーザー | `asset_manager` |
| パスワード | `devpassword` |

### スキーマ同期について

ローカル開発では **`prisma db push`**（`npm run db:setup` / `npm run db:deploy:local`）で素早くスキーマを反映します。本番デプロイは `deploy.yml` 内で `prisma migrate deploy` を実行し、`prisma/migrations` のマイグレーション履歴を適用します。

スキーマを変更した場合は `npm run db:dev` でマイグレーションファイルを生成し、`prisma/migrations` にコミットしてください。

```bash
# スキーマを変更したあと
npm run db:deploy:local
npm run dev   # 再起動
```

> [!IMPORTANT]
> **`db push` だけで済ませると、本番にだけテーブルが作られません。** ローカルもCIも
> `prisma db push` で `schema.prisma` を直接反映するため、マイグレーションを生成し忘れても
> どこも失敗しません。一方で本番は `prisma migrate deploy` しか実行しないため、履歴に無い
> テーブルは本番DBに一度も作られず、画面を開いた時点で
> `The table X does not exist in the current database` になります
> （レシートAI取込の6テーブルで実際に発生: #236）。

#### マイグレーションの生成漏れを確認する / 後から埋める

CI（`.github/workflows/test.yml` の Migration drift check）が毎回この確認を行うため、生成漏れは
Pull Requestの時点で落ちます。手元で確かめたい場合は、シャドウDBを用意して同じコマンドを
実行します（差分があれば終了コード 2）。

```bash
sudo mysql -e "CREATE DATABASE IF NOT EXISTS asset_manager_shadow;
               GRANT ALL PRIVILEGES ON asset_manager_shadow.* TO 'asset_manager'@'localhost';"
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url 'mysql://asset_manager:devpassword@127.0.0.1:3306/asset_manager_shadow' \
  --exit-code
```

シャドウDBを用意できない環境では、**最後にマイグレーションを追加したコミット時点の
`schema.prisma`** を起点にすれば、DBなしで同じ差分を出せます（生成漏れを後から埋めるときの手順）。

```bash
git show <そのコミット>:prisma/schema.prisma > /tmp/old-schema.prisma
DIR="prisma/migrations/$(date -u +%Y%m%d%H%M%S)_<名前>"
mkdir -p "$DIR"
npx prisma migrate diff \
  --from-schema-datamodel /tmp/old-schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "$DIR/migration.sql"
```

### Google ログイン（ローカル開発）

ログインは Supabase Auth 経由の Google OAuth のみです。ローカル開発でも設定が必要です。初回ログイン時にダミーデータが自動投入されます。

複数アプリで共有の**開発用 Supabase プロジェクト**を使います（本番用プロジェクトとは別。詳細は [m-guchi/vps#42](https://github.com/m-guchi/vps/issues/42) 参照）。

**必要な設定:**

1. 開発用 Supabase プロジェクトの Authentication > URL Configuration の Redirect URLs に以下を追加:

```
http://localhost:3000/auth/callback
```

2. `.env.local` の `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` に、開発用 Supabase プロジェクトの値を記入
3. `npm run dev` で `http://localhost:3000/login` を開く

**よくあるエラー:**

| 症状 | 対処 |
|------|------|
| `redirect_uri_mismatch` | Supabase プロジェクトの Redirect URLs に上記 URL を追加 |
| Google ログインがエラーになる | `.env.local` の `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` が空でないか確認 |
| ログイン画面も含め**全ページが500**になる | 同上。空だと `middleware.ts` がSupabaseクライアントを作れず、ページに入る前に落ちる（ログには `Your project's URL and Key are required to create a Supabase client!`）。**画面の中身とは無関係**なので、UIの変更を疑う前にここを見る |

### 別端末（スマホ等）からの動作確認

`npm run dev` 起動時に、以下のアクセス経路がコンソールに表示されます。

- **LAN 内**: `http://<LAN-IP>.sslip.io:3000`（同じ Wi-Fi 上のスマホ等から）
- **外出先**: `https://asset-dev.minagu.work`（Cloudflare Tunnel + Cloudflare Access 経由。自分の Google アカウントのみ許可）

いずれも `next.config.ts` の `allowedDevOrigins`（`*.sslip.io` / `*.minagu.work`）でクロスオリジンリクエストを許可しています。

**LAN 内からのアクセス（Windows + WSL2 の場合）**

WSL2 の IP は再起動のたびに変わるため、WSL 再起動後は管理者権限の PowerShell で以下を再実行して portproxy を張り直します。

```powershell
scripts\windows\expose-dev-server.ps1
```

開発用 Supabase プロジェクトの Redirect URLs にも `http://<LAN-IP>.sslip.io:3000/auth/callback` の追加が必要です（[Google ログイン（ローカル開発）](#google-ログインローカル開発)参照）。

**外出先からのアクセス（Cloudflare Tunnel）**

`cloudflared tunnel run dev-tunnel` を起動しておくと、`npm run dev` 実行時に表示される `https://asset-dev.minagu.work` からアクセスできます（Cloudflare 側のトンネル・Access 設定はこのリポジトリの管理外です）。

### 本番 DB のローカル接続（デバッグ用）

本番データの確認が必要な場合のみ、SSH トンネル経由で接続します。

```bash
npm run prod:tunnel
```

スマホ等 LAN/Cloudflare Tunnel（`https://asset-dev.minagu.work`）経由でこのモードにアクセスする場合は、本番用 Supabase プロジェクトの Redirect URLs に `https://asset-dev.minagu.work/auth/callback` を追加しておく必要があります（Supabase ダッシュボード側の設定のためこのリポジトリの管理外）。未追加のままだと `redirect_uri_mismatch` でログインできません。

### 環境変数の管理

ローカル開発の秘密情報（Supabase 等）はすべて `.env.local` に平文で保存します（`.gitignore` 済みのためコミットされません）。1Password は本番デプロイと本番 DB 確認にのみ使用します。

| 用途 | テンプレート | コマンド | 1Password |
|------|-------------|----------|-----------|
| ローカル開発 | `.env.local`（`.env.local.example` からコピー） | `npm run dev` | 不要 |
| 本番 DB（ローカル接続） | `.env.1password.prod.tpl` | `npm run prod:tunnel` | 必要（DB 認証情報 + 本番用 Supabase） |
| GitHub Actions デプロイ | GitHub の secret / variable（`.github/secrets-manifest.tsv`） | `main` への push で自動実行 | 実行時は不要（値を変えたときの同期のみ） |

Supabase プロジェクトはローカル開発用（`.env.local` に平文で保存）と本番用（1Password の `apps/Supabase` アイテム、他アプリと共有）で別のものを使い分けます。

1Password を使う場合（本番 DB 接続・GitHub 側への同期）:

```bash
eval "$(op signin)"   # または export OP_SERVICE_ACCOUNT_TOKEN=...
npm run verify:op     # 本番 DB 用テンプレートの op:// 参照を確認
```

デプロイで使う値の同期は「[2. シークレットの配布](#2-シークレットの配布)」を参照してください。

---

## ✅ デプロイ前のテスト・品質チェック

本番環境にデプロイしてビルドエラーを起こさないために、Push前に以下の品質チェックを実行してエラーが出ないか確認することを推奨します。

### 一括実行（推奨）

lint・型チェック・本番ビルドを順番に実行します（`build:local` は `.env.local` を使用、1Password 不要）。

```bash
npm run check
```

### 個別実行

必要に応じて、以下のコマンドを個別に実行することもできます。

```bash
# 1. Linter（静的コード解析）による構文や未使用変数のチェック
npm run lint

# 2. TypeScriptの型チェック（型エラーの検知）
npm run typecheck

# 3. ローカルでの本番ビルドテスト（ローカル DB 接続情報を使用）
npm run build:local
```

すべてのコマンドがエラーなく（`✓ Compiled successfully` など）完了すれば、デプロイやPushの準備は完了です。

---

## 🚀 デプロイ方法 (GitHub Actions 経由)

本アプリケーションは、`main` ブランチへの Push 操作をトリガーとして、VPS等へ自動デプロイされるよう GitHub Actions ワークフロー (`.github/workflows/deploy.yml`) が構成されています。

### 1. サーバー側の前提条件
- Ubuntu 等の Linux サーバー (Node.js 20系 が動作すること)
- SSHログイン可能なユーザーが存在すること
- PM2 がインストールされていること (`npm install -g pm2`)
- 必要な環境（MySQL/PostgreSQL等）がデプロイ先に構築されているか、外部データベースを利用できること

### 2. シークレットの配布

ワークフローは実行時に **GitHub の secret / variable** から値を取ります（`op://` の実行時参照は行いません）。
以前は実行のたびに 1Password から読んでいましたが、サービスアカウントの日次レート制限（**1Password アカウント全体で 1,000 リクエスト/日**。サービスアカウントを分けても分割されません）を使い切り、フリート全体のデプロイが止まったためです（[issue-deck#1302](https://github.com/guchi-apps/issue-deck/issues/1302)）。

1Password は「人が管理する唯一の正」として残し、**値を変えたときだけ** `scripts/sync-github-secrets.sh` で GitHub 側へ同期します。どの値を GitHub 側のどこへ置くかの対応表が `.github/secrets-manifest.tsv` です。

| 置き場所 | 対象 | 備考 |
|---------|------|------|
| organization の共通値 | `SERVER_*`（SSH 接続）・`SHARED_DB_*`（共有 MariaDB）・`SUPABASE_*` | 他アプリと共有。このリポジトリでの設定は不要 |
| このリポジトリの secret | `TARGET_DIR`・`DB_NAME`・`SIGNALY_*_WEBHOOK_URL` | ログでマスクされる |
| このリポジトリの variable | `NEXT_PUBLIC_GA_ID` | クライアントバンドルに埋め込まれる公開値 |

ワークフローのジョブに書く `env:` ブロックは、対応表から `scripts/generate-workflow-env-block.sh` で生成できます。

#### 2-1. 1Password にデプロイ用アイテムを作成

値の正は 1Password です。保管庫名 `apps` に、次のアイテムを作成してください（GitHub 側へは 2-2 の同期で反映します）。

**アイテム `AssetManager`**（セキュアノート等）

| フィールド名 | 内容 | 環境変数 |
|-------------|------|----------|
| `db-name` | 本番用データベース名 | `DB_NAME`（デプロイ時に `DATABASE_URL` を組み立て） |
| `ga-id` | Google Analytics 測定 ID | `NEXT_PUBLIC_GA_ID` |
| `ci-webhook-url` | CI/デプロイ結果を通知する Signaly の Webhook URL | `SIGNALY_WEBHOOK_URL` |
| `register-webhook-url` | 新規登録通知用 Signaly の Webhook URL（現在未使用。[signaly#112](https://github.com/m-guchi/signaly/issues/112) 対応後に使用予定） | `SIGNALY_REGISTER_WEBHOOK_URL` |
| `target-dir` | デプロイ先ディレクトリ | 例: `/home/github-user/asset.gucchii.com` |

ログイン通知の Webhook URL（`SIGNALY_LOGIN_WEBHOOK_URL`）は全アプリ共通の 1 チャンネルへ集約したため、このアイテムではなく `op://apps/Notify/login-webhook-url` を正とする organization secret から受け取ります（guchi-apps/issue-deck#2287）。

ログイン通知の**中身のフォーマットの正は [signaly の `docs/webhook.md`「ログイン通知の共通フォーマット」](https://github.com/guchi-apps/signaly/blob/develop/docs/webhook.md)** です（guchi-apps/signaly#204）。1 チャンネルへ集約している以上、揃えるのは送る側の役目で、Signaly は受け取った通知を整え直しません。`lib/signaly.ts` で変えてよいのは `APP_NAME` と Webhook URL の環境変数名だけです。

- フィールド名 `接続元IP` を変えないこと。Signaly はこの名前で「見覚えのない接続元からのログインか」を判定し、初めての接続元なら通知を黄色にします
- 通知の `source` は CI/デプロイ通知の `NOTIFY_APP` と同じ `Asset Manager` にします。`.github/scripts/signaly-notify.sh` は `NOTIFY_APP` があれば embed に `App` を載せ、Signaly は `App` を `Repository` より優先して送信元にするため、リポジトリ名にすると通知一覧の送信元が 2 つに割れます

**アイテム `Supabase`**（複数アプリ共有、[m-guchi/vps#42](https://github.com/m-guchi/vps/issues/42) 参照）

| フィールド名 | 内容 | 環境変数 |
|-------------|------|----------|
| `project-url` | 本番用 Supabase プロジェクトの URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `publishable-key` | 本番用 Supabase の Publishable key | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |

**アイテム `DB`**（MyRoom と共有可）

| フィールド名 | 内容 | 環境変数 |
|-------------|------|----------|
| `db-user` | MySQL ユーザー名 | `DB_USER` |
| `db-password` | MySQL パスワード | `DB_PASSWORD` |
| `db-host` | 本番用 MySQL ホスト | `DB_HOST`（デプロイ時） |
| `db-port` | 本番用 MySQL ポート | `DB_PORT`（デプロイ時） |

**アイテム `Server`**（MyRoom と共有可）

| フィールド名 | 内容 |
|-------------|------|
| `host` | サーバーのホスト名または IP |
| `username` | SSH ユーザー名 |
| `ssh-port` | SSH ポート番号 |

**アイテム `githubaction-sshkey`**（「SSH 鍵」アイテム型・MyRoom と共有可）

| フィールド ID | 内容 |
|-------------|------|
| `private_key` | サーバー接続用 SSH 秘密鍵 |

Vault 名やアイテム名を変える場合は、`.github/secrets-manifest.tsv` と `.env.1password.prod.tpl` の `op://...` 参照も合わせて更新してください。

参照の確認:

```bash
op item get AssetManager --vault apps --format json | jq '.fields[] | {id, label}'
op read "op://apps/githubaction-sshkey/private_key?ssh-format=openssh"
```

> **⚠️ エラー 400: redirect_uri_mismatch が発生する場合**
> Supabase プロジェクトの Authentication > URL Configuration「Redirect URLs」に以下の URL を追加してください。
> - 本番環境: `https://asset.gucchii.com/auth/callback`
> - ローカル環境: `http://localhost:3000/auth/callback`

#### 2-2. GitHub 側へ同期する

1Password の値を変えたときだけ実行します。**個人アカウントのセッション**で実行してください（サービスアカウントには書き込み権限が無く、日次レート制限の枠も消費しません）。

```bash
eval "$(op signin)"
scripts/sync-github-secrets.sh --dry-run   # 差分だけ確認
scripts/sync-github-secrets.sh
scripts/sync-github-secrets.sh --only SIGNALY_WEBHOOK_URL   # 一部だけ
```

GitHub の Actions タブ（および issue-deck の画面）からは `Sync secrets` ワークフロー（`.github/workflows/sync-secrets.yml`）で同じ同期を起こせます。

`OP_SERVICE_ACCOUNT_TOKEN`（1Password Service Account のトークン。`apps` 保管庫への読み取り権限が必要）は GitHub Secret に残していますが、**デプロイ・CI では使いません**。`Sync secrets` ワークフローのように 1Password を読む処理だけが使います。

#### 2-3. 本番サーバーの `.env`

デプロイ時に GitHub の secret から渡した `DB_*` を `scripts/construct-database-url.sh` で `DATABASE_URL` に組み立て、サーバー `.env` に同期します（既存の同名キーは上書き、それ以外は保持）。

| 環境変数 | GitHub 側の取得元 | 1Password（正） |
|----------|------------------|----------------|
| `DATABASE_URL` | `SHARED_DB_*`（org secret）+ `DB_NAME`（repo secret） | `DB` の `db-*` + `AssetManager` の `db-name` から自動生成 |
| `NEXT_PUBLIC_SUPABASE_URL` | `SUPABASE_PROJECT_URL`（org variable） | `Supabase` の `project-url` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `SUPABASE_PUBLISHABLE_KEY`（org variable） | `Supabase` の `publishable-key` |
| `NEXT_PUBLIC_GA_ID` | `NEXT_PUBLIC_GA_ID`（repo variable） | `AssetManager` の `ga-id` |
| `SIGNALY_LOGIN_WEBHOOK_URL` | `SIGNALY_LOGIN_WEBHOOK_URL`（**org secret**） | `Notify` の `login-webhook-url`（全アプリ共通） |
| `SIGNALY_REGISTER_WEBHOOK_URL` | `SIGNALY_REGISTER_WEBHOOK_URL`（repo secret） | `AssetManager` の `register-webhook-url`（現在未使用） |


### 3. デプロイの実行
設定が完了したら、`main` ブランチへ変更を Push するか、GitHub の Actions タブから `Deploy to VPS` ワークフローを手動で実行 (`workflow_dispatch`) してください。

#### ワークフローの流れ:
1. GitHub の secret / variable をジョブの `env:` に読み込み、GitHub 側でビルド (`npm run build`) およびアーカイブの作成が行われます。
2. 作成されたパッケージ (`deploy.tar.gz`) が `scp` でサーバーへ転送されます。
3. サーバー上でアーカイブが展開され、`.env` が GitHub 側から渡された値で同期されます。
4. 本番用パッケージ (`npm install --omit=dev`) のインストール、`prisma migrate deploy` による DB スキーマ同期が走ります。
5. `pm2` を利用して Node.js アプリケーションがポート `3102` で再起動されます。

> **`ecosystem.config.js` からプロセスを削除しただけでは本番に残る。**
> デプロイは `pm2 delete asset-manager`（本体のみ）→ `pm2 start ecosystem.config.js` → `pm2 save`
> という流れのため、定義から消したcronプロセスはVPSのPM2に登録されたまま残ります。実体の
> スクリプトはデプロイ時に入れ替わって消えるので、**起動するたびに失敗し続ける**状態になります。
> cronプロセスを廃止するときは、VPS上で `pm2 delete <プロセス名> && pm2 save` を手作業で
> 実施してください（#191）。
