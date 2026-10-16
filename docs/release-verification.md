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
  作れない。サブPCで一度だけ `npm run db:setup:verify` を実行する。未作成のままでも、`VERIFY_DB_NAME` 未指定なら
  `verify-build.sh` が権限付与済みの `am_ci_shadow` へ自動で切り替える（#704）
- マイグレーションSQLの検証（`migrate diff`）は別物で、こちらは含まない

## リリースworkflowの新方式対応（#748）

`.github/workflows/release-develop-to-main.yml` は issue-deck の新方式（候補作成 → 公開準備 → 本番反映）の入力
`candidate_request`・`finalize_request` を受け、共有workflowの `candidate-request`・`finalize-request` へ渡す。
空なら従来どおり。issue-deck の画面の「候補を作成して検証」はこの入力の有無で押せるかを決める。

- **採用した共有タグ**: `workflows/v52`（`5cf7981a`）。両入力を持ち、同期pushで旧方式の新規バンプを始めない修正
  （issue-deck#4650・PR #4652）を含む。版番号ではなく内容で判断している。タグは上書きしない
- **版の同期**: 版は `package.json` のみ（`version-file`・`bump-command` は既定）。`preversion` 等が無く、
  既定の `npm version` で書き換わる。公開準備は計算した `NEW_VERSION` と実ファイルを照合し、不一致なら失敗する。
  更新履歴は共有workflowが書く `.github/release-notes.md`。`ios/` は無く、iOS版の同期は不要
- **反映状況は別々に記録する**: developへのPRマージ／main側のcaller反映（次のdevelop→mainリリース）／通し確認
  （候補→公開準備→main反映→deploy→develop同期。実リリースを伴うため人が行う）。全repo展開の追跡は issue-deck#4651
- mainが旧callerのままの間は新方式の入口がmainに無い。初回はdevelopのcallerを `--ref develop` で起動できるか確認する
