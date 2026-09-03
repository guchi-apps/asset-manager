# asset-manager 固有ルール

このリポジトリで作業する Claude Code エージェント向けのルールを記載する。

**GitHub Actions 上での実行は、このリポジトリをチェックアウトしたワークツリーしか参照できない。**
したがって無人実行でも守られる必要があるルールは、このファイルに明文化しておく必要がある。

## 検証コマンド（**命名が紛らわしいので必ず確認する**）

このリポジトリは、他のアプリと `build` 系の命名が**逆**になっている。取り違えると
無人実行・CIが環境不足で落ちる。

| コマンド | 中身 | 用途 |
|---|---|---|
| `npm run build` | `next build --webpack` | **ラッパー無し。CI・無人実行はこちら** |
| `npm run build:local` | `bash scripts/with-local-env.sh npm run build` | ローカル用。`.env` を要求する |
| `npm run check` | `lint && typecheck && build:local` | **ローカル用**（`build:local` を含む） |

無人実行で使うのは次の3つ。

| 目的 | コマンド |
|---|---|
| Lint | `npm run lint` |
| 型チェック | `npm run typecheck` |
| ビルド | `npm run build` |
| テスト | `npm test`（`node --import tsx --test` で `lib/*.test.ts` を実行） |

**`npm run check` は使わない。** `build:local` を含むため、ローカルの `.env` が無い環境では落ちる。

### `npm test` は対象を明示列挙している（**足し忘れ・消し忘れが黙って通る**）

`scripts.test` は `node --import tsx --test lib/a.test.ts lib/b.test.ts ...` と対象を並べており、
**node は存在しないファイルを黙って読み飛ばして終了コード0を返す**。そのため

- テストファイルを削除・改名して列挙を直し忘れても、テストは成功したまま
- テストファイルを追加して列挙に足さなければ、一度も実行されない

`lib/*.test.ts` を追加・削除・改名したら、必ず `package.json` の列挙も同時に直し、
実行件数（`ℹ tests <n>`）が想定どおり増減したかで確かめる（実例: #302）。

### スキーマを変えたら `db push` と マイグレーションSQL の**両方**を用意する

ローカルの `asset_manager_dev` はmigrateのベースラインが無く、`prisma migrate deploy` は
`Error: P3005 The database schema is not empty.` で落ちる。ローカルでの確認は
`bash scripts/with-local-env.sh npx prisma db push`（CIも `db push --accept-data-loss`）。

**ただし本番のデプロイは `prisma migrate deploy`。** `db push` はマイグレーションを生成しないため、
`prisma/migrations/<timestamp>_<name>/migration.sql` を手で置かないと**本番のデプロイだけが失敗する**。
ローカルとCIが通っていることは、本番へ出せることの根拠にならない（実例: #302）。

CI（`.github/workflows/test.yml`）は Lint → `prisma db push --accept-data-loss` → `npm run build`
の順に実行している。Nodeは `'20'`。

### worktreeで最初に検証するとき（**2つとも既知の初期状態で、壊れているのではない**）

- **`npm run typecheck` の前に `npx prisma generate` を実行する。** Prisma Clientが未生成の
  worktreeでは、`lib/receipt-service.ts` の `Parameter 'row' implicitly has an 'any' type` や
  `lib/valuation-change.ts` の `Module '@prisma/client' has no exported member 'TransactionType'`
  といった、**自分の変更と無関係なファイル**の型エラーが十数件出る。原因が分かりにくいが、
  `npx prisma generate` を1回流せば全部消える。CIは `prisma db push` が生成を兼ねるので出ない
- **`npm run dev` は起動するが、全ページが500になる。** worktreeへコピーされる `.env.local` の
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` が空のため、
  `middleware.ts` が `Your project's URL and Key are required to create a Supabase client!` で
  落ちる。ログインの背後どころかトップも出ないので、**画面での確認が要る変更では値を入れてから
  起動する**（`auth-dev-login` skill）

  **このリポジトリには開発用ログイン導線（`/api/dev/login` のようなCookieバイパス）が無い**
  （#340で確認。`ci-login-bypass` / `dev/login` / `devLogin` のいずれも実装が無い）。
  そのため `auth-dev-login` skill の「導線を使う」手順は使えず、`.env.local` へ**開発用Supabase
  プロジェクトの実値**を入れる以外に、ログインの背後の画面を出す方法が無い。ダミー値を入れても
  `middleware.ts` が `AuthRetryableFetchError` を拾って503を返すため、保護されたページは開かない。
  値が手元に無い状況で画面確認が必須なら、導線の追加を別Issueとして起票する

## `middleware.ts` の `getUser()` は `error` を見ないと通信不達を未ログインと誤判定する（実例: #316）

`supabase.auth.getUser()` は毎回 Supabase Auth サーバーへ通信するため、通信不達・5xx・
レート制限(429)で失敗した場合も戻り値は `user: null` になる（＝本当に未ログインの場合と
区別がつかない）。`error` を見ずに `!user` だけで「未ログイン」と判定すると、通信が不安定な
とき（**PWAは起動のたびにネットワークスタックがコールドスタートするため、特に陥りやすい**）に
ログイン済みユーザーを誤って `/login` へ戻してしまう。

`error.name === "AuthRetryableFetchError"`（通信不達・5xx）または `error.status === 429` の
ときはリダイレクトせず、一時的なエラー画面（503）を返す（`middleware.ts` の
`isAuthUnreachable()` / `serviceUnavailable()`）。同じ対策は `car-care` / `dayspan` /
`trainroute` にも入っている。

## AIDE・Zaim連携で2度踏んだ落とし穴（実例: #335）

**AIDEの `POST /api/zaim/payment/web` はカテゴリ・内訳を「名前」で受け取る。**
公式API経由の `POST /api/zaim/payment` は `categoryId` / `genreId` を取るが、Web版の口が
操作するのは入力画面で、画面はIDを受け取らない。同じAIDEでも口によって違う。
IDで送っていたあいだ、レシートのZaim登録は内訳が何であれ400
「categoryName（カテゴリ名）が必要です」で必ず失敗していた。
**このリポジトリだけを見ても気づけない。** AIDE側（`guchi-apps/aide` の
`src/core/connectors/zaim/web-payment.ts`）の受け口を読んで、送る本文と突き合わせる。

**Zaimのマスタで無効を表す `active` は `-1`。`0` は返ってこない。**
`active !== 0` で有効判定をすると、削除・非表示にした項目が全部有効として保存される
（実測で内訳199件中125件、口座135件中103件）。内訳が `active: 1` でも、属するカテゴリが
`-1` なら入力画面には出ないので落とす。詳細は `docs/receipt-import.md`。

## 評価額（`Asset`）は取引に付随しない独立した記録（実例: #343・#356）

`Asset` は「カテゴリ×日で1行」に upsert される（`lib/valuation-change.ts` の
`planAssetSnapshotWrite`）。**Zaimの自動取得が入れた行と、手入力の取引に付けた評価額は同じ1行を
共有する**ため、どちらが作った行なのかは見分けられない。取引・評価額とも記録時刻は
`normalizeRecordDate`（JST 12:00）に丸められるので、`recordedAt` も完全に一致する。

したがって**取引の削除・日付変更で `Asset` を消してはいけない**。#356 までは
`deleteHistoryItem('tx', id)` が `asset.deleteMany({ categoryId, recordedAt })` を無条件で実行して
おり、Zaimが記録した評価額が一緒に消えていた。現在はどちらの操作も `Transaction` だけを触り、
残った評価額は履歴に「評価額更新」の行として現れるので個別に消せる
（`app/actions/assets.ts`）。`Asset` を消してよいのは、評価額の行そのものを削除・日付変更した
ときだけで、`where` には必ず `id` と `userId` を入れる。

同じ理由で、取引と一緒に評価額を保存する経路も `asset.create` ではなく
`planAssetSnapshotWrite` を通す（`create` するとZaimの行と二重になる）。既存の値を書き換える
ことになる場合は `needsConfirmation` が返るので、呼び出し側は上書き確認を出して
`confirmOverwrite` を渡し直す。

機械が作った取引を取り消す導線は、いまも取引だけを消す専用の口を用意する
（例: `lib/recurring-deposit.ts` の `cancelRecurringDeposit`）。対象の取引を id で特定でき、
履歴画面の実装に依存しないため。

## 評価額（`Asset`）の記録は日次で揃わない（実例: #343）

「前日との差」を前提にした計算は落ちる。Zaimの自動取得は連携口座の最終更新が記録日より前なら
保存を見送り（`lib/zaim-sync-policy.ts` の `staleSource`）、書き戻せるのも1日ぶんまで
（`lib/zaim-freshness.ts` の `ZAIM_BACKFILL_MAX_DAYS = 1`）。投信の口座は土日に更新されないため、
**どの月にも必ず記録の穴が空く**。

日次系列を扱うときは「前日」ではなく**直近の記録**と比べ、何日ぶんの差なのかを持ち回ること。
穴をまたいだ差には複数日ぶんの値動きが混ざるため、それを1日ぶんの変動として扱うと必ず誤る。
詳細は `docs/zaim-auto-sync.md`。

## ファイルの改行コード（**編集前に必ず確認する**）

`.gitattributes` が LF に固定しているのは `*.sh` / `*.tpl` / `docker-compose.yml` /
`.env.1password.tpl` だけで、`*.ts` などは**コミットされている改行コードのまま**。
実際に `lib/signaly.ts` は CRLF、`lib/signaly-webhook.ts` は LF と、同じディレクトリ内でも混在している。

sed・python・ヒアドキュメントでファイルを丸ごと書き直すと改行コードが LF へ寄り、
中身は数行しか変えていないのに**全行が差分になる**（実例: #241 で 3 行の変更が 127 行の差分になった）。
書き直す前に `file <path>` で確認し、CRLF のファイルは書き戻したあとに改行コードを復元して
`git diff --stat` が想定どおりの行数かを確かめる。

`.github/workflows/*.yml` は特に注意する。ファイル全体が CRLF なのは問題ないが、
`- "CI\r"` のように**引用符の内側に1文字だけ** CR が入ると YAML として読めなくなり、
GitHub はジョブを1つも作らないまま即失敗する run を記録する
（`gh run view` も「This run likely failed because of a workflow file issue」としか出さず、
ログが残らない）。CRLF のファイルから値を引いて YAML へ差し込むときは `tr -d '\r'` を通し、
`grep -c $'\r' .github/workflows/*.yml` が 0 であることを確かめる（実例: #247）。

## 開発サーバーの止め方（**`pkill -f` は必ずポートで絞る**）

`pkill -f` はコマンドラインの全文に一致する。開発サーバーを止めるつもりのパターンが、
**セッションの `claude` プロセス**にも一致して落とす事故が2つの形で起きている。

1. **worktreeのパスをパターンにした場合。** 開発サーバーだけでなく**そのセッション自身**
   （`tmux new-session -c <worktree>` とログインシェル、Bashツールのシェル）にも一致し、
   tmuxセッションごと落ちる（実例: #269・#276）
2. **開発サーバーの起動コマンド名をパターンにした場合。** issue-deckのランチャーは起動
   プロンプトを `claude` の**引数**として渡しており、その中に
   「開発環境: http://localhost:9331（未起動・worktreeで pnpm dev を実行すると起動します）」
   の一文が入る。つまり**開発サーバーが未起動のセッションは、リポジトリを問わず `claude` の
   コマンドラインに `pnpm dev` という文字列を持っている**。`pkill -f "pnpm dev"` はそれを
   全部撃ち抜く（実例: #331。`npm run dev` でも同じ）

撃たれた側は作業が終わっていても `Pane is dead (status 143)` で落ち、issue-deckには
「セッションが異常終了しました。終了コード: `143`」とだけ出て `00.check-user` +
`01.check-blocked` が付く。撃った側のログにも何も残らないため、原因が分からない。

```bash
pkill -f "asset-manager-worktrees/issue-276"   # ダメ。セッションごと落ちる
pkill -f "pnpm dev"                            # ダメ。他リポジトリのセッションまで落ちる
pkill -f "next-server.*9276"                   # ポートで絞る
fuser -k 9276/tcp                              # でもよい
```

実例: #269 のセッションが実装途中で落ち、続きを引き継いだ #276 のセッションも後片付けで
同じ踏み方をした。2026-09-02には別リポジトリ（`issue-deck` #2738）のセッションが打った
`pkill -f "pnpm dev"` で、asset-manager #329・myroom #302・myroom #343 の3セッションが
同時に落ちている（#331）。**自分のworktreeしか壊さないとは限らない。**

## マルチエージェント運用（GitHub Actions 無人実行）

`@claude` コメントを起点に、計画提示〜実装〜develop向けPR作成までを GitHub Actions 上で無人実行する。
ワークフローの実体は `guchi-apps/issue-deck` にあり、このリポジトリの `.github/workflows/` には
`uses:` で参照する薄い caller だけを置いている（`@workflows/v9`）。

| ファイル | 役割 |
|---|---|
| `claude-issue-dispatch.yml` | `@claude` 起点の無人実行（計画提示・実装・PR作成・質問応答） |
| `issue-labels.yml` | Issueの進捗（Project Status）の状態遷移 |

設計・運用の詳細は issue-deck 側を参照する。

- 進捗管理の設計: [progress-status-architecture.md](https://github.com/guchi-apps/issue-deck/blob/main/docs/progress-status-architecture.md)
- 無人実行の挙動: [multi-agent/dispatch.md](https://github.com/guchi-apps/issue-deck/blob/main/docs/multi-agent/dispatch.md)

**`/install-github-app` を実行しないこと。** 生成される素の `claude.yml` は
`claude-issue-dispatch.yml` と同じ `issue_comment` イベントで起動するため、1つのコメントで
Claude が二重に走る（`subscription-lists` で実際に起きた）。

`.claude/settings.json` はローカルの Claude Code 用の権限許可リストで、この運用とは別物。

## ブランチ運用

- `main` は本番と一致するリリース用ブランチ。直接pushは禁止し、`develop` → `main` のPRのみで進める
- `develop` が日常の開発ブランチ。**デフォルトブランチは `develop`**（`issues`・`issue_comment`
  イベントはデフォルトブランチのワークフローしか起動しないため、変更すると無人実行が動かなくなる）
- Issue専用ブランチは `develop` から作成し、ブランチ名は **`issue-<Issue番号>`** とする（例: `issue-155`）。
  ワークフローはブランチ名から対象Issueを特定するため、**この命名規約に従わないブランチはすべて対象外**になる

## Issueの進捗

**進捗は GitHub Projects の Status で管理する。進捗ラベルは存在しない**
（issue-deck#1010 / #991 Phase 5 で `01.wip`〜`09.main` を廃止した）。

1. `Ready` — 未着手
2. `Planning` — 計画検討中（`21.plan-required` 選択時のみ経由）
3. `Implementation` — 実装中
4. `Develop PR` — developへPR作成・マージ中
5. `Develop` — developへマージ完了（main未反映）
6. `Release` — mainへPR作成・マージ中
7. `Done` — mainへマージ完了。この時点でissueをcloseする

**`gh issue edit` で進捗を進めることはできない。** Status を書けるのは issue-deck だけで、
ワークフローは進捗報告API（`POST /api/progress`）へ報告する。ブランチのpush・PR作成・PRマージを
トリガーに自動で遷移するため、エージェントが自分で進捗を動かす必要はない。

## 条件を表すラベル（進捗とは別軸）

| ラベル | 意味 |
|---|---|
| `00.check-user` | ユーザーの確認・指示が必要。どの段階でも併用する |
| `00.qa-answered` | 質問への回答のみ完了（`00.check-user` と常に併用） |
| `11.local` | ローカル（VSCode等）で対応中。付いている間は無人実行を起動しない |
| `21.plan-required` | 実装前に計画を提示し承認を得る |
| `22.merge-confirm-required` | 内容によらず、developへのマージ前に必ず `00.check-user` を付ける |
| `23.preview-required` | PR作成前に開発サーバーでの画面確認を必須にする |
| `24.screenshot-required` | PR作成前にスクリーンショット取得を必須にする |

## 自動マージ不可カテゴリ

以下に該当する変更は自動マージせず `00.check-user` を付与してユーザーの確認を待つ。

- 認証・認可
- DBスキーマ変更・マイグレーション（`prisma/**`）
- 本番環境の設定
- GitHub Actionsやデプロイ設定（`.github/workflows/**`）
- Secretsや環境変数（`.env*`・1Password関連）
- 課金・決済
- 大規模な依存関係の更新
- `develop` → `main` のマージ

## 実装エージェントの禁止事項

- `main` / `develop` への直接コミット・push
- 他Issueのブランチの編集
- 不要なforce push
- 自分が作成したPull Requestの自己マージ
- **本番DBへの接続**（`tunnel:*`・`prod:tunnel`・`db:*:prod` 系のスクリプト）

## コミット・PR・コメントの書き方

- コミットメッセージ・PRタイトル・PR本文・issueコメントは**日本語**で書く
- コミットの author は `Claude Code <claude-code@example.com>` にする
- `develop` 宛のPR本文には、対応Issue・実装内容・テスト内容・確認方法・注意点を記載する。
  developマージ時点ではissueをcloseしない運用のため、`closes #番号` / `fixes #番号` は使わず
  `#番号` のみ記載する

## 依存関係の追加

新しい依存関係を追加する前には、必ずユーザーに確認を取る。無人実行では確認相手がいないため、
追加が必要だと判断した場合は追加せずに作業を止め、`00.check-user` を付与したうえで
なぜ必要かをIssueコメントで相談する。
