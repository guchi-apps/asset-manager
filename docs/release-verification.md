# リリース検証（サブPCでのビルド検証）

CIのビルドは `prisma db push` を先に流す。サブPCで同じ手順を再現するため、専用の検証DBと
コマンドを用意している（#698。issue-deckの統合検証 `guchi-apps/issue-deck#4378` から使う）。

## コマンド

| 目的 | コマンド |
|---|---|
| 検証DBの作成（初回のみ・sudo） | `npm run db:setup:verify` |
| スキーマ反映 + ビルド | `npm run verify:build` |

`verify:build` は `.env.local` も1Passwordも要らない。`prisma db push --accept-data-loss` →
`npm run build` を、検証DBへ向けて実行する（CIの「Database schema sync」「Build check」と同じ）。

## 接続設定

既定は `asset_manager` ユーザーで `127.0.0.1:3306` の `asset_manager_verify`。環境変数
`VERIFY_DB_USER` / `VERIFY_DB_PASSWORD` / `VERIFY_DB_HOST` / `VERIFY_DB_PORT` / `VERIFY_DB_NAME` で
上書きできる。実値はリポジトリへ置かない（既定はローカル専用の開発用の値）。

## 安全装置

`--accept-data-loss` はDBの中身を壊す。開発DB（`asset_manager_dev`）や本番へ誤って向けないよう、
`scripts/verify-build.sh` は**DB名が `*_verify`（または既存のシャドウDB `am_ci_shadow`）でなければ
実行を拒否**し、`DB_HOST` がローカル以外でも拒否する。

## 注意

- `asset_manager_verify` の作成にはMySQL管理者権限（`sudo mysql`）が要るため、エージェントは
  作れない。サブPCで一度だけ `npm run db:setup:verify` を実行する
- マイグレーションSQLの検証（`migrate diff`）は別物で、こちらは含まない
