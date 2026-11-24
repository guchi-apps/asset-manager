# リリース検証（サブPCでのビルド検証）

CIのビルドは `prisma db push` を先に流す。サブPCで同じ手順を再現するため、専用の検証DBと
コマンドを用意している（#698。issue-deckの統合検証 `guchi-apps/issue-deck#4378` から使う）。

## コマンド

| 目的 | コマンド |
|---|---|
| 検証DBの作成（初回のみ。subpcはsudo、macOSは不要） | `npm run db:setup:verify` |
| スキーマ反映 + ビルド | `npm run verify:build` |

`verify:build` は `.env.local` も1Passwordも要らない。`prisma db push --accept-data-loss` →
`npm run build` を、検証DBへ向けて実行する（CIの「Database schema sync」「Build check」と同じ）。

## macOS（Mac mini / macmini）の手順（#1539）

subpc（Ubuntu・`sudo mysql`）と違い、Homebrew の MySQL 8.0 を `brew services`（launchd）で常駐させる。
本番はMariaDB、CI・ローカルはMySQL 8.0なので、検証もMySQL 8.0で揃える。

```bash
brew install mysql@8.0              # 初回のみ（導入は事前にユーザー確認）
brew services start mysql@8.0       # 常駐（127.0.0.1:3306）
npm run db:setup:verify             # 初回のみ。Darwin では sudo なしの `mysql -u root` で実行する
npm run verify:build
```

- `setup-verify-db.sh` は `uname -s` が `Darwin` のとき `mysql -u root` を使う。ユーザーは `localhost` と
  `127.0.0.1` の両方に作る（何度実行しても同じ結果になる）
- `verify-build.sh` はBSD版コマンドのままで動く（macmini で `prisma db push` → `npm run build` の成功を確認済み）
- Dockerは入っておらず常駐のメモリも増えるため採らない。db-console の `verify-build.sh` のような使い捨ての
  mysqld を一時ディレクトリで起動する方式は、DB事前作成が要らない利点があるが、`db push` の接続先設計を変える
  ことになるため今回は見送り、必要なら別Issueで検討する

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
- `verify:build` は `db push` で、権限の広いユーザーで流す。**マイグレーションSQLそのものは通らない**ので、
  本番で使う権限での確認は次の「本番と同じ権限でのマイグレーション検証」を使う

## 本番と同じ権限でのマイグレーション検証（#1637）

本番のデプロイは `prisma migrate deploy` を**マイグレーション用ユーザー（`app-migrator`）**で流す。ローカル・CI・
`verify:build` は権限の広いユーザー（root・`ALL PRIVILEGES`）なので、本番に無い権限を使うマイグレーションも通り、
本番だけが落ちる。#1630 では `CREATE TEMPORARY TABLES` を使った `20261227120000_fix_tag_groups` が、本番で
`1044 Access denied` になった。

### 権限の前提

`app-migrator` が持つのは、DB単位の次の権限だけ（出典: `guchi-apps/vps` の `docs/web-stack.md`
「マイグレーション用アカウント」。本番DBへは接続しないので、この文書が正）。

```
SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
```

**持たない**もの（マイグレーションSQLに書かない）: `CREATE TEMPORARY TABLES`・`TRIGGER`・`LOCK TABLES`・
`CREATE VIEW`・`CREATE ROUTINE`・`EXECUTE`・`DROP DATABASE`（`CREATE DATABASE`）・`GRANT OPTION`。
`PREPARE` / `EXECUTE` による文の動的実行は権限を要さず、通る（`20261227120000_fix_tag_groups` が使っている）。

### 検証の方法

| 場所 | 内容 |
|---|---|
| ローカル（subpc） | `npm run db:setup:migrate-verify`（初回のみ・sudo）→ `npm run verify:migrate` |
| CI | `Migration deploy with production-equivalent privileges` ステップが、上と同じ権限の `am_migrator` を作り、空DBへ全履歴を `migrate deploy` する |

`verify:migrate` は専用DB `asset_manager_migrate_verify` の表を全部消し（`DROP DATABASE` は本番権限に無いため表だけ）、
`am_migrator_verify`（上の権限のみ）で履歴を頭から適用する。DB名が `*_verify` でない・ホストがローカルでないときは
実行を拒否する。接続先は `MIGRATE_VERIFY_DB_{USER,PASSWORD,HOST,PORT,NAME}` で上書きできる。

`#1630` の一時表版（`ddba5a1^`）を戻して流すと、`Database error code: 1044` /
`Access denied for user 'am_migrator_verify'` で失敗することを確認済み。付与する権限を変えるときは、
`scripts/setup-migrate-verify-db.sh` と `.github/workflows/test.yml` の両方を揃える。

### 検証できないこと

- **MariaDB と MySQL 8.0 の構文差（#930）**: ローカル・CIはMySQL 8.0のため、MariaDBでだけ（またはMySQLでだけ）通る
  構文は拾えない。権限の絞り込みとは別の問題で、MariaDBのDBを用意する別Issueが要る
- **本番の権限が文書と食い違っている場合**: 文書（vps）を正としている。本番のGRANTを変えたら、ここも直す
- **既存データに対する挙動**: 空DBに適用するだけなので、データがある状態での失敗や所要時間は見えない

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
