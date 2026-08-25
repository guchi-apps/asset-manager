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

CI（`.github/workflows/test.yml`）は Lint → `prisma db push --accept-data-loss` → `npm run build`
の順に実行している。Nodeは `'20'`。

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
