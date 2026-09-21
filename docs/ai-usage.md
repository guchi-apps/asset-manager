# AIの使用量の記録と `GET /api/ai-usage`（Issue #535）

ops-dashboard の「アプリ別のAI利用」（[ops-dashboard#325](https://github.com/guchi-apps/ops-dashboard/issues/325)）
が、このアプリのAI利用（どの機能が、どのモデルで、どれだけ使ったか）を読むための記録と口。
連携の向きは **ops-dashboard のサーバーがこのアプリを読みにくる**形で、このアプリから送りつけはしない。
応答の形の正は ops-dashboard の README「アプリ別のAI利用」と `src/lib/ai-app-usage/parse.ts`。

## 何を記録するか

Anthropic API を呼ぶ箇所は `lib/anthropic-messages.ts` の `requestAnthropicMessage` 1つに集約されている。
**成功した応答1件につき1行**を `AiUsageLog` へ書く（`lib/ai-usage-log.ts` の `saveAiUsage`）。

| 列 | 内容 |
|---|---|
| `feature` | 機能の識別子（下表）。表示名は集計時に引くので、名前を直しても過去の行が割れない |
| `model` | **応答が返したモデルID**（日付付きのことがある）。応答に無ければ要求したID |
| `inputTokens` | **キャッシュに載らなかった**入力トークン（`usage.input_tokens`） |
| `outputTokens` | `usage.output_tokens` |
| `cacheReadTokens` | `usage.cache_read_input_tokens` |
| `cacheWriteTokens` | `usage.cache_creation_input_tokens` |
| `createdAt` | 記録時刻 |

| 識別子 | ops-dashboard に出す名前 | 呼び出し元 |
|---|---|---|
| `receipt-image` | レシート画像の解析 | `analyzeReceiptImage`（`lib/receipt-analysis.ts`） |
| `receipt-mail` | メール明細の解析 | `analyzeReceiptMail` |
| `receipt-classify` | 商品名の内訳分類 | `classifyItemsWithAi` |
| `rebalance-advice` | 資産配分アドバイス | `requestRebalanceAdvice`（`lib/rebalance-advice.ts`） |

- **記録するのは回数とトークン数だけ。** プロンプト本文・応答・ユーザーは持たない（`userId` も無い。アプリ全体の使用量）
- **失敗した呼び出しは数えない。** HTTPエラー・通信不達には `usage` が無く、課金もされない前提のため。
  応答は返ったが解析に失敗した（JSONが壊れていた・拒否された）呼び出しは、トークンを使っているので数える
- **記録に失敗しても、AIの結果は返す。** すでに課金された解析結果を、記録できなかっただけで捨てない。
  失敗はサーバーログに `AI usage log failed:` で出る（このとき使用量が実際より少なく出る）
- 呼び出し箇所を足すときは `lib/ai-usage.ts` の `AI_FEATURES` と `AI_FEATURE_LABELS` に足し、
  `requestAnthropicMessage` の `options.feature` を必ず指定する（型で漏れない）
- 行は消していない。1回の呼び出しが1行で、量は多くない（レシート・アドバイスを人が操作したぶんだけ）

## `GET /api/ai-usage`

`app/api/ai-usage/route.ts`。認証は `Authorization: Bearer <OPS_API_TOKEN>`（ops-dashboard と同じ値）。
`OPS_API_TOKEN` が無い・違う・**サーバー側が未設定**のときは、いずれも 401（`lib/ops-api-auth.ts`）。
セッションは持たないので、`lib/public-paths.ts` の公開パスに入れてある。

```json
{ "features": [
  { "label": "レシート画像の解析", "model": "claude-opus-5",
    "last24h": { "calls": 2, "inputTokens": 1500, "outputTokens": 150, "cacheReadTokens": 20, "cacheWriteTokens": 5 },
    "last7d":  { "calls": 3, "inputTokens": 2200, "outputTokens": 220, "cacheReadTokens": 20, "cacheWriteTokens": 5 } } ] }
```

- 機能×モデルごとに1行。同じ機能でモデルを切り替えていれば2行になる
- 直近24時間・7日間は、**同じ「いま」を上限**に切った集計（`lib/ai-usage-log.ts` の `getAiUsageResponse`）
- 7日間にだけ呼び出しがある行は、24時間側を `0` で埋める（ops-dashboard は両方の期間を必須にしている）
- 呼び出しが無ければ `{ "features": [] }`（エラーにしない）
- 数値はすべて負でない整数。**1行でも形が違うと、ops-dashboard は応答全体を「取得不可」にする**ため、
  形を変えるときは ops-dashboard 側の `parse.ts` と突き合わせる

## 連携させるには

ops-dashboard の `AI_APP_USAGE_SOURCES`（JSON配列）に、このアプリのURLを足す（ops-dashboard 側の設定）。

```json
[{"app":"asset-manager","url":"https://<このアプリのドメイン>/api/ai-usage"}]
```

このアプリ側には `OPS_API_TOKEN` が要る。値の正は ops-dashboard の `OPS_API_TOKEN`
（1Password の `op://apps/ops-dashboard/ops-api-token`）で、`.github/secrets-manifest.tsv` に載せてある。
デプロイ（`deploy.yml`）が本番の `.env` へ書く。**GitHub側へは、issue-deck の画面の「Sync secrets」
（`sync-secrets.yml`。`only` に `OPS_API_TOKEN`）で一度同期する必要がある。**
同期前にデプロイすると `OPS_API_TOKEN` が空で書かれ、口は常に 401 になる（落ちはしない）。

ローカルで叩くときは `.env.local` に `OPS_API_TOKEN` を入れる（本番と同じ値を持ち込まなくてよい）。

```bash
curl -s -H "Authorization: Bearer $OPS_API_TOKEN" http://localhost:3000/api/ai-usage
```

## 確かめ方

- 単体テスト: `lib/ai-usage.test.ts`（集計・応答の形）、`lib/anthropic-messages.test.ts`（記録・失敗時の扱い）、
  `lib/ops-api-auth.test.ts`（認証）。**テストは記録先を `setAiUsageRecorder` で差し替える**。差し替え忘れると
  `fetch` をスタブしたテストが開発DBへ行を書く
- ローカルDBに対して実物の `GET` を呼ぶ方法は CLAUDE.md の「サーバーアクションはローカルDBに対して
  直接実行して確かめられる」と同じ。この口は `getCurrentUserId` も `next/cache` も使わないので、
  ローダーフックは要らず、`NextRequest` を作って `GET` をそのまま呼べる
