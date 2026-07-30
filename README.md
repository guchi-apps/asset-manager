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
  - 最新の評価額の一括更新

- 📝 **取引履歴 (Transactions)**
  - 資産ごとの取引（入出金や売買など）の記録と管理

- 🔐 **認証・セキュリティ (NextAuth.js)**
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

### Google ログイン（ローカル開発）

ログインは Google OAuth のみです。ローカル開発でも設定が必要です。初回ログイン時にダミーデータが自動投入されます。

本番用の OAuth クライアントとは別に、**開発用の OAuth クライアント**を使います（本番のリダイレクト URI 設定を汚さないため）。

**必要な設定:**

1. [Google Cloud Console](https://console.cloud.google.com/) で開発用の OAuth 2.0 クライアントを作成（本番用のプロジェクト/クライアントとは別のものを用意）し、リダイレクト URI に以下を追加:

```
http://localhost:3000/api/auth/callback/google
```

2. `.env.local` の `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` に発行された値を記入（`NEXTAUTH_SECRET` / `NEXTAUTH_URL` は `cp .env.local.example .env.local` の時点で設定済み）
3. `npm run db:setup` 済みであること（`Account` テーブルなどが存在する状態）
4. `npm run dev` で `http://localhost:3000/login` を開く

**よくあるエラー:**

| 症状 | 対処 |
|------|------|
| `The table Account does not exist` | `npm run db:deploy:local` を実行してスキーマを同期 |
| `redirect_uri_mismatch` | Google Cloud に上記リダイレクト URI を追加 |
| Google ログインがエラーになる | `.env.local` の `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` が空でないか確認 |
| `Callback` エラーでログイン画面に戻る | DB スキーマ未同期の可能性 → `npm run db:deploy:local` |

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

Google OAuth のリダイレクト URI にも `http://<LAN-IP>.sslip.io:3000/api/auth/callback/google` の追加が必要です（[Google ログイン（ローカル開発）](#google-ログインローカル開発)参照）。

**外出先からのアクセス（Cloudflare Tunnel）**

`cloudflared tunnel run dev-tunnel` を起動しておくと、`npm run dev` 実行時に表示される `https://asset-dev.minagu.work` からアクセスできます（Cloudflare 側のトンネル・Access 設定はこのリポジトリの管理外です）。

### 本番 DB のローカル接続（デバッグ用）

本番データの確認が必要な場合のみ、SSH トンネル経由で接続します。

```bash
npm run prod:tunnel
```

スマホ等 LAN/Cloudflare Tunnel（`https://asset-dev.minagu.work`）経由でこのモードにアクセスする場合は、本番用 Google OAuth クライアントの承認済みリダイレクト URI に `https://asset-dev.minagu.work/api/auth/callback/google` を追加しておく必要があります（Google Cloud Console 側の設定のためこのリポジトリの管理外）。未追加のままだと `redirect_uri_mismatch` でログインできません。

### 環境変数の管理

ローカル開発の秘密情報（OAuth・NextAuth 等）はすべて `.env.local` に平文で保存します（`.gitignore` 済みのためコミットされません）。1Password は本番デプロイと本番 DB 確認にのみ使用します。

| 用途 | テンプレート | コマンド | 1Password |
|------|-------------|----------|-----------|
| ローカル開発 | `.env.local`（`.env.local.example` からコピー） | `npm run dev` | 不要 |
| 本番 DB（ローカル接続） | `.env.1password.prod.tpl` | `npm run prod:tunnel` | 必要（DB 認証情報 + 本番用 OAuth クライアント） |
| GitHub Actions デプロイ | `.github/deploy.env.tpl` | `main` への push で自動実行 | 必要（本番用一式） |

Google OAuth クライアントはローカル開発用（`.env.local` に平文で保存）と本番用（1Password の `auth-google-id` / `auth-google-secret`）で別のものを使い分けます。

1Password を使う場合（本番 DB 接続・デプロイ確認）:

```bash
eval "$(op signin)"   # または export OP_SERVICE_ACCOUNT_TOKEN=...
npm run verify:op     # 参照確認
```

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

### 2. 1Password の設定

デプロイ用の秘密情報は 1Password で管理し、GitHub Actions から `1password/load-secrets-action` で読み込みます（[MyRoom](https://github.com/gucchii/myroom) と同じ構成）。

#### 2-1. 1Password にデプロイ用アイテムを作成

保管庫名 `apps` に、次のアイテムを作成してください。

**アイテム `AssetManager`**（セキュアノート等）

| フィールド名 | 内容 | 環境変数 |
|-------------|------|----------|
| `db-name` | 本番用データベース名 | `DB_NAME`（デプロイ時に `DATABASE_URL` を組み立て） |
| `nextauth-url` | 本番環境のベース URL | `NEXTAUTH_URL` |
| `nextauth-secret` | NextAuth セッション暗号化キー | `NEXTAUTH_SECRET` |
| `auth-google-id` | Google OAuth クライアント ID | `AUTH_GOOGLE_ID` |
| `auth-google-secret` | Google OAuth クライアントシークレット | `AUTH_GOOGLE_SECRET` |
| `ga-id` | Google Analytics 測定 ID | `NEXT_PUBLIC_GA_ID` |
| `ci-webhook-url` | CI/デプロイ結果を通知する Signaly の Webhook URL | `SIGNALY_WEBHOOK_URL` |
| `login-webhook-url` | ログイン通知用 Signaly の Webhook URL | `SIGNALY_LOGIN_WEBHOOK_URL` |
| `register-webhook-url` | 新規登録通知用 Signaly の Webhook URL | `SIGNALY_REGISTER_WEBHOOK_URL` |
| `target-dir` | デプロイ先ディレクトリ | 例: `/home/github-user/asset.gucchii.com` |

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

Vault 名やアイテム名を変える場合は、`.github/deploy.env.tpl` と `.env.1password.prod.tpl` の `op://...` 参照も合わせて更新してください。

参照の確認:

```bash
op item get AssetManager --vault apps --format json | jq '.fields[] | {id, label}'
op read "op://apps/githubaction-sshkey/private_key?ssh-format=openssh"
```

> **⚠️ エラー 400: redirect_uri_mismatch が発生する場合**
> Google Cloud コンソールの「認証情報」画面にて、OAuth 2.0 クライアントの「承認済みのリダイレクト URI」に以下の URL を追加してください。
> - 本番環境: `https://asset.gucchii.com/api/auth/callback/google`
> - ローカル環境: `http://localhost:3000/api/auth/callback/google`

#### 2-2. Service Account を作成

1. 1Password で Service Account を作成し、`apps` 保管庫への読み取り権限を付与
2. 発行されたトークンを GitHub リポジトリの Secret に登録

| GitHub Secret | 内容 |
|---------------|------|
| `OP_SERVICE_ACCOUNT_TOKEN` | 1Password Service Account のトークン（**これだけ** GitHub に残す） |

以前 GitHub Secrets に登録していた `DATABASE_URL` / `VPS_SSH_KEY` / `VPS_HOST` などは、1Password へ移行後に削除できます。

#### 2-3. 本番サーバーの `.env`

デプロイ時に 1Password から読み込んだ `DB_*` を `scripts/construct-database-url.sh` で `DATABASE_URL` に組み立て、サーバー `.env` に同期します（既存の同名キーは上書き、それ以外は保持）。

| 環境変数 | 1Password アイテム | フィールド |
|----------|-------------------|-----------|
| `DATABASE_URL` | DB + AssetManager | `db-*` + `db-name` から自動生成 |
| `NEXTAUTH_URL` | AssetManager | `nextauth-url` |
| `NEXTAUTH_SECRET` | AssetManager | `nextauth-secret` |
| `AUTH_GOOGLE_ID` | AssetManager | `auth-google-id` |
| `AUTH_GOOGLE_SECRET` | AssetManager | `auth-google-secret` |
| `NEXT_PUBLIC_GA_ID` | AssetManager | `ga-id` |
| `SIGNALY_LOGIN_WEBHOOK_URL` | AssetManager | `login-webhook-url` |
| `SIGNALY_REGISTER_WEBHOOK_URL` | AssetManager | `register-webhook-url` |


### 3. デプロイの実行
設定が完了したら、`main` ブランチへ変更を Push するか、GitHub の Actions タブから `Deploy to VPS` ワークフローを手動で実行 (`workflow_dispatch`) してください。

#### ワークフローの流れ:
1. 1Password から秘密情報を読み込み、GitHub 側でビルド (`npm run build`) およびアーカイブの作成が行われます。
2. 作成されたパッケージ (`deploy.tar.gz`) が `scp` でサーバーへ転送されます。
3. サーバー上でアーカイブが展開され、`.env` が 1Password の値で同期されます。
4. 本番用パッケージ (`npm install --omit=dev`) のインストール、`prisma migrate deploy` による DB スキーマ同期が走ります。
5. `pm2` を利用して Node.js アプリケーションがポート `3102` で再起動されます。
