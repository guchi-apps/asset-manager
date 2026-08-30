# レシートAI取込 → Zaim「反映待ち」連携

Issue #153。レシート画像をAIで構造化し、Asset Manager側で確認・修正してから
Zaimの「反映待ち」口座へ登録する。カード明細が反映されたら置き換え候補を提示し、
統合そのものはZaim標準の「置き換え」に任せる。

スマートレシート・Amazon由来の明細（#222）も、画像が無いだけで同じ流れに載せている。

画面は `/receipts`（**家計簿連携**）と `/receipts/<id>`（確認・修正）。スマホでの利用を主用途にしている。
`/receipts` は「明細 / 内訳の提案 / 設定」の3タブで、内訳の自動振り分け・口座間コピー・Gmail取り込みは
すべて Issue #271 で足したもの（後述）。

**写真からのレシート撮影は画面から外してある**（#271）。解析（`lib/receipt-analysis.ts`）・画像の保存先・
`uploadReceiptAction`・`ReceiptSource.PHOTO` はそのまま残っているので、必要になれば
`components/receipts/receipts-content.tsx` へ導線を戻すだけで復活する。

## 方針

- **AIの出力をそのままZaimへ送らない。** 必ずAsset Manager側で状態を持ち、検算に通ったものだけを送る
- **金額の突き合わせはAIに任せない。** 明細の合計とレシート総額の照合は `lib/receipt-verify.ts` が行う
- **自動確定は高信頼のみ。** 判定は1か所（`canAutoConfirm`）に集約し、運用実績を見て緩めるときもそこだけを変える
- **統合はZaim標準の「置き換え」を使う。** Asset Managerは候補を出すだけで、削除も統合もしない
- 評価額の取得はAIDEの巡回結果を読む経路（`lib/zaim-aide.ts`。#191）。支出の登録・参照だけこちらのAPIを使う

## なぜ評価額はスクレイピング、支出はAPIなのか

評価額（#145）は残高画面を読むだけなので、認証をブラウザのstorage stateで賄えるスクレイピングで足りていた
（巡回そのものは#191でAIDEへ移したが、経路がスクレイピングであることは変わらない）。
支出の登録では次の2つが要るためAPIにした。

- **登録した明細のid** — 重複登録の判定と、置き換え候補の照合（自分が登録した明細を候補にしない）に要る
- **失敗時の巻き戻し** — 商品ごとに登録するため、途中で失敗したら消す必要がある

両者は共存する。スクレイピング側のstorage stateとセッション維持はAIDEが持つ（`docs/zaim-auto-sync.md`）。

## データの流れ

```
撮影/選択
  └ storage/receipts/<userId>/<YYYY-MM>/<sha256>.<ext> へ保存（DBにはパスとハッシュだけ）
      └ Claude API で構造化抽出（店舗・日時・商品・数量・単価・値引き・税・総額・信頼度）
          └ 商品分類履歴（ProductClassificationRule）でAIの分類を上書き
              └ 検算（明細合計 vs 総額）→ 高信頼なら CONFIRMED、それ以外は REVIEW_REQUIRED
                  └ 画面で確認・修正 → 確定（触った分類を履歴へ保存）
                      └ Zaim「反映待ち」口座へ商品ごとに登録 → SENT_TO_ZAIM
                          └ カード明細が反映されたら置き換え候補を提示（統合はZaimの「置き換え」）
```

## 設定

`.env`（ローカルは `.env.local`）に次を設定する。値の説明は `.env.local.example` にある。

| 変数 | 用途 |
| --- | --- |
| `ANTHROPIC_API_KEY` | レシート解析。未設定だと撮影ボタンが押せない |
| `ANTHROPIC_RECEIPT_MODEL` | 任意。未設定なら `claude-opus-5` |
| `RECEIPT_STORAGE_DIR` | 任意。未設定なら `<リポジトリ>/storage/receipts` |
| `ZAIM_CONSUMER_KEY` / `ZAIM_CONSUMER_SECRET` | Zaim開発者サイトで発行 |
| `ZAIM_ACCESS_TOKEN` / `ZAIM_ACCESS_TOKEN_SECRET` | `scripts/zaim-oauth.ts` で取得 |
| `ZAIM_PENDING_ACCOUNT_ID` | 「反映待ち」口座の `account_id` |
| `ZAIM_OAUTH_CALLBACK_URL` | 任意。既定は `http://localhost:9153/zaim/callback` |
| `ZAIM_SMART_RECEIPT_ACCOUNT_ID` | 任意。未設定なら口座名から自動判定 |
| `ZAIM_AMAZON_ACCOUNT_ID` | 任意。未設定なら口座名から自動判定 |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` | Google Cloudで発行（種類は「デスクトップアプリ」） |
| `GMAIL_REFRESH_TOKEN` | `scripts/gmail-oauth.ts` で取得 |
| `GMAIL_OAUTH_REDIRECT_URI` | 任意。既定は `http://localhost:9271/gmail/callback` |

**Zaim・Anthropic・GmailのキーはGitHub Secrets経由では配っていない。** `.github/secrets-manifest.tsv`
に載っているのはデプロイに要る値だけで、これらは本番VPSの `.env` へ直接置く運用になっている（#221）。
`deploy.yml` の `sync_env_var` は既存の行を消さないため、デプロイしても残る。

`ZAIM_SYNC_USER_EMAIL` に設定したユーザーだけが画面を使える（既存のZaim連携と同じ認可。`lib/zaim-access.ts`）。

### アクセストークンの取得手順

OAuth 1.0a の認可はブラウザでしか完了できず、このサーバーにはGUIが無い。
そのため「URLを表示 → 手元のブラウザで許可 → 戻り先URLを貼る」形にしている。

```bash
# 1. https://dev.zaim.net/ でアプリを登録し、コンシューマキー/シークレットを .env へ書く
# 2. 認可フローを実行する（表示されたURLを手元のブラウザで開く）
npx -y tsx --env-file-if-exists=.env scripts/zaim-oauth.ts
# 3. 表示された2行を .env へ貼る
# 4. 「反映待ち」口座の id を調べて ZAIM_PENDING_ACCOUNT_ID に設定する
npx -y tsx --env-file-if-exists=.env scripts/zaim-oauth.ts --accounts
```

設定が済んだら、画面の「Zaimのマスタを取得」を押して内訳（ジャンル）と口座を取り込む。
**この取り込みをしないとAIが内訳を選べない**（実在しないidを返させないため、選択肢はマスタから作っている）。

### 署名を疑う前に

OAuth 1.0a の署名は1文字ずれても401としか返ってこないため、実サービスを叩いて切り分けようとすると詰まる。
`lib/zaim-oauth.test.ts` は、RFC 5849 / Twitterが公開している検証用データ（consumer secret・token secret・
nonce・timestamp・期待する署名がすべて揃っている）に対して署名関数を通し、期待値と一致することを確かめている。
**このテストが通っていれば署名の実装は正しい**ので、401が出たときはコンシューマキー・アクセストークンの
設定側を疑う。

パーセントエンコードは自前で実装している。`encodeURIComponent` が `!*'()` を素通しするため、
そのまま使うと署名が一致しない。

## 画像の保存先

`storage/receipts/` に置く。`.gitignore` 済みで、`deploy.yml` のクリーンアップ
（`rm -rf .next public package.json ... scripts lib ...`）にも含まれないため、デプロイしても残る。

ファイル名は画像のSHA-256にしている。同じ写真を二度取り込んでも増えず、
取り込み時に同じハッシュの取り込みがあれば新規作成せず既存を返す（重複登録の防止）。

配信は `/api/receipts/<id>/image` を通してのみ行い、所有者以外には404を返す。
Web公開ディレクトリには置かない。

## 自動化レベル

`lib/receipt-verify.ts` の `verifyReceipt` が3段階を返す。

| レベル | 条件 | 挙動 |
| --- | --- | --- |
| `high` | 検算が合い、警告が1つも無く、全体・各行の信頼度が0.9以上 | 取り込み直後に自動で `CONFIRMED` |
| `medium` | 検算は合うが、信頼度が中程度・店舗名や購入日時が欠けている | 確認待ち（`REVIEW_REQUIRED`） |
| `low` | 検算が合わない・内訳未決定・信頼度0.6未満の行がある・明細や総額が読めない | 確認待ち |

- 明細合計と総額の差が **1円以内** は端数として扱い、不一致にはしない（`ROUNDING_TOLERANCE_YEN`）。ただし自動確定はしない
- 外税表示のレシートは、AIが `taxIncludedInItems: false` を返したときだけ「明細合計＋税額」で検算する
- **検算が合わないレシートは確定できない**（`confirmReceipt` が弾く）。内訳が未決定の商品が残っていても同じ

## 商品分類履歴

「商品名 → Zaimカテゴリ/内訳」の対応を `ProductClassificationRule` に貯め、AIの判断より優先する。

- キーは正規化した商品名（`lib/receipt-normalize.ts`）と正規化した店舗名。**店舗一致の規則を優先し、無ければ店舗を問わない規則へ落ちる**
- 履歴に残すのは、人が触った行（`MANUAL`）と履歴どおりに使われた行（`HISTORY`）だけ。
  **AIの出力を素通しした行は残さない** — 誤分類が「人が確認した分類」として固定されるため
- 店舗名の正規化は末尾の「店」「支店」を落とすため、`イオン西新井店` と `イオン西新井` は同じ規則になる

正規化は表記だけを揃える。全角英数→半角、半角カナ→全角、軽減税率の印（`※`）・税表記・単価/個数表記の除去、
記号と空白の除去、小文字化。空白をすべて落とすのは、印字位置で空白が入ったり入らなかったりするため
（`lib/zaim-match.ts` の `toMatchKey` と同じ理由）。

## Zaimへの登録

確定したレシートを、**商品ごとに1件ずつ**「反映待ち」口座へ登録する（`from_account_id` に
`ZAIM_PENDING_ACCOUNT_ID`）。内訳を残すことがこの機能の目的なので、1件に丸めない。

- `name` に商品名、`place` に店舗名、`comment` に `Asset Manager レシート取込 #<id>` を入れる
- 登録した `money.id` は `ReceiptItem.zaimMoneyId` に、先頭のidは `ReceiptImport.zaimMoneyId` に保存する
- **途中で失敗したら、それまでに登録した分をすべて削除してから中断する。** 半端な明細が残ると置き換えの手順が壊れる
- 登録済み（`SENT_TO_ZAIM`）のレシートは編集も削除もできない

### money idはINTに収まらない（Issue #281）

Zaimの明細id（`money.id`）は2026-08時点で **約 1.02×10^10**（例: `10212021703`）まで伸びており、
MySQLのINT（上限 `2147483647`）には収まらない。INTの列へ入れると取り込みが必ず
`Out of range value for column 'zaimMoneyId'` で落ちる。

- money idを保存する列は**すべて`BigInt`（BIGINT）**にする。対象は
  `ReceiptImport.zaimMoneyId` / `ReceiptItem.zaimMoneyId` / `ReceiptItem.sourceZaimMoneyId` /
  `ReceiptMatchCandidate.zaimMoneyId` / `ZaimGenreSuggestion.zaimMoneyId` /
  `ZaimCopiedEntry.sourceMoneyId` / `ZaimCopiedEntry.copiedMoneyId`
- 口座id・カテゴリid・内訳idは別系統で、実測の最大が 6,679万なのでINTのままでよい
- アプリ側は`number`で持ち回す。Prismaは`BigInt`列を`bigint`で返すので、DBから出たところで
  `lib/zaim-money-id.ts` の `toMoneyIdNumber` / `toMoneyIdNumberOrNull` を通す。
  `bigint` のままサーバーアクションの戻り値へ載せるとJSONにできず落ちる
  （値は `Number.MAX_SAFE_INTEGER` に対して5桁以上の余裕がある）
- 書き込みはPrismaが`number`をそのまま受け取るため、変換は要らない

## 置き換え候補

「置き換え候補を更新」を押すと、直近70日ぶんの支出をZaim APIから取得し、
`SENT_TO_ZAIM` のレシートごとに候補を出す（`lib/receipt-match.ts`）。

| 条件 | 加点 |
| --- | --- |
| 金額が一致 | +0.6 |
| 金額の差が10円または1%以内 | +0.35 |
| 購入日との差が3日以内 | +0.25 |
| 7日以内 | +0.15 |
| それ以上（62日まで） | +0.05 |
| 店舗名が一致（一方が他方を含む） | +0.15 |

- 0.5未満は提示しない。1レシートあたり最大5件
- **「反映待ち」口座の明細は候補にしない。** 自分が登録したものを候補に出しても意味がない
- 62日を超えて離れた明細は、金額が一致していても別の買い物として扱う
- 1件の明細が複数のレシートの候補になることは許す。どちらが正しいかは人が決める
- 「違う」を押して却下した候補は、洗い直しても戻らない

**自動削除・自動統合は行わない。** 統合はZaim標準の「置き換え」で人が行う。

## スマートレシート・Amazon由来の明細（Issue #222）

Zaimへ連携済みのスマートレシート・Amazonの明細を取り込み、内訳を補正してから
「反映待ち」へコピーする。画像が無いだけで、確認・確定・置き換え候補の流れは撮影したレシートと同じ。

```
「Zaim連携明細を取り込む」
  └ GET /v2/home/money（直近60日・payment）
      └ from_account_id が連携口座のものだけ残す
          └ 由来口座・日付・店舗名でまとめて取り込み1件にする
              └ 内訳を補正（Zaimの分類 → 商品分類履歴 → AI）
                  └ 全商品が履歴で決まったものだけ CONFIRMED、それ以外は REVIEW_REQUIRED
                      └ 確定後、「反映待ち」へ登録（一覧の「まとめて『反映待ち』へ登録」）
```

### 由来の見分け方

Zaim APIの `money` レスポンスには「どの連携サービス由来か」を示す項目が無い
（`ZaimMoneyResponseItem` の項目は id / mode / date / category_id / genre_id /
from_account_id / to_account_id / amount / comment / active / name / place だけ）。

一方で、**Zaimの外部サービス連携は連携ごとに専用の口座を作る**。実際の口座一覧にも
「スマートレシート」「Amazon.co.jp」という口座が並んでいるため、`from_account_id` が
その口座と一致するかどうかで由来を判定できる（`lib/zaim-linked-source.ts`）。

**`place` や `name` の文字列からは判定しない。** 店舗名は買い物のたびに変わるが、
口座idは連携を貼り直さない限り変わらない。

口座は既定では名前（「スマートレシート」「Amazon」を含むもの）から自動で判定する。
同じ語を含む口座が複数あるときは、どれが連携口座か機械では決められないため判定しない
（誤った口座から取り込むと家計簿を壊すため）。その場合と口座名を変えている場合は、
`ZAIM_SMART_RECEIPT_ACCOUNT_ID` / `ZAIM_AMAZON_ACCOUNT_ID` で口座idを直接指定する。

### 商品内訳の粒度

Zaimの連携が明細を商品単位で作るか、1件に丸めるかは連携の種類によって変わる。
どちらでも同じ形になるよう、**由来口座・日付・店舗名でまとめて取り込み1件**にしている
（`lib/zaim-linked-import.ts`）。1件しか無ければ商品1つの取り込みになり、商品単位で
並んでいれば内訳がそのまま残る。品目名が空の明細は、確認画面で何も出ないのを避けるため店舗名で代用する。

Amazonの事情もこの粒度でそのまま扱える。

| Amazonの事情 | 扱い |
| --- | --- |
| 複数商品の同時決済 | 同じ日の明細が1件へまとまるので、カード請求と同じ金額になる |
| 分割発送 | 発送ごとに決済日が変わるため、別々の取り込みとして分かれる |
| 決済日ずれ | 取り込みでは吸収せず、置き換え候補側の日付許容（最大62日）で吸収する |

### 内訳の補正

後のものほど強い。

1. **Zaimが連携時に付けた内訳** — 信頼度 `LINKED_SOURCE_CONFIDENCE`（0.5）で置く。
   スマートレシートの内訳は誤っていることがあるため、このままでは必ず確認待ちに落ちる
2. **商品分類履歴** — 人が確認済みの分類なので最優先。信頼度1
3. **AIの分類** — 履歴で決まらなかった商品だけを商品名で分類する（`classifyItemsWithAi`）。
   信頼度は `LINKED_AI_CONFIDENCE_CAP`（0.85）で頭打ちにする

**自動確定できるのは、全商品が分類履歴で決まった取り込みだけ。** 3の上限が
`HIGH_CONFIDENCE_THRESHOLD`（0.9）より低いのはそのためで、AIの分類だけでは自動確定に届かない。
「スマートレシートは内訳が正しくない場合があるため、単純な自動コピーは行わない」（#153）を、
自動確定の判定（`canAutoConfirm`）を変えずに満たしている。

`ANTHROPIC_API_KEY` が無くても取り込み自体は動く。その場合は1と2だけで補正し、残りは確認待ちになる。

### 二重取り込みの防止

- 取り込んだZaim明細のidを `ReceiptItem.sourceZaimMoneyId` に残し、次回は除外する
- 同じ日・同じ店の明細があとから増えた場合は、まだ「反映待ち」へ送っていない取り込みへ足す
  （`ReceiptImport.sourceKey`）。送信済みの取り込みへ足すと登録済みの明細と食い違うため、
  その場合は連番を付けた別の取り込みにする
- Zaimで**集計対象外にした明細（`active` が 0）は取り込まない。** 置き換えを済ませた元明細を拾い直さないため

### 置き換え候補との関係

連携由来の取り込みは、**元明細と金額・日付・店舗がすべて一致する**。除外しないと必ず最上位の
候補になってカード明細を隠すため、`ReceiptImport.sourceAccountId` の口座の明細は候補にしない
（`lib/receipt-match.ts`）。連携口座にカード明細が入ることは無いので、口座ごと外して問題ない。

### 触らないもの

**Zaim側の元明細には一切手を触れない。** 削除も、集計対象外への変更もしない。
「反映待ち」へコピーしたあと、元のスマートレシート・Amazon明細を集計対象外にする操作は
これまでどおりZaimの画面で行う（Zaim APIの支出更新に集計対象外を切り替える項目が無く、
自動削除・自動統合を行わないという #153 の方針にも合わせている）。

## 内訳の自動振り分け（Issue #271）

`/receipts` の「内訳の提案」タブ。**連携口座に限らずZaim全体の支出**から、内訳が決まっていないものを
集めて提案する。実装は `lib/zaim-genre-suggest.ts`（判定）と `lib/kakeibo-service.ts`（DB・API）。

```
「Zaimから読み込む」
  └ GET /v2/home/money（直近60日・payment）
      └ 内訳が決まっていない支出だけ残す（isSuggestableEntry）
          └ 商品分類履歴で提案（信頼度1・最初からチェック済み）
              └ 決まらなかった行だけAIへ渡す（信頼度は0.85で頭打ち・チェックは人が入れる）
                  └ ZaimGenreSuggestion へ保存（この時点でZaimは何も変わらない）
                      └ 「反映」で内訳だけをZaimへ書き戻す
```

### 「決まっていない」の判定

`isGenreUndecided` が次のいずれかなら対象にする。

- `genre_id` が無い、または `0`（Zaim APIは未分類の支出に0を返す）
- 取り込んだ内訳マスタに無いid（画面の選択肢に出せない内訳は、利用者から見れば空欄と変わらない）
- ジャンル名が「その他」「未分類」「使途不明金」

品目（`name`）が空の明細は店舗名（`place`）を手がかりにする。どちらも空なら分類できないので、
提案なしの行として残す（画面から手で選べる）。

### 書き戻しで触るもの・触らないもの

`updateZaimPaymentGenre` が更新するのは **`category_id` と `genre_id` だけ**。
Zaimの更新APIは `date` と `amount` を必須にしているため元明細の値をそのまま送り返しており、
**この2つに `fetchZaimMoney` で取った値以外を渡すと金額や日付まで書き換わる**。
口座（`from_account_id`）と集計対象外（`active`）はそもそも送らない。

反映できた提案のうち、分類履歴で決まったもの・画面で選び直したものは `ProductClassificationRule` へ
残す。AIの提案を素通しした行を残さないのは、誤分類が「人が確認した分類」として固定されるため
（既存の `collectRuleUpserts` と同じ方針）。

## 口座間コピー（Issue #271）

「設定」タブでコピー元・コピー先の口座を登録すると、コピー元の支出をコピー先へ同じ内容で登録する。
これまで手で行っていた「スマートレシート・Amazonの明細を『反映待ち』へコピーする」作業がこれにあたる。
判定は `lib/zaim-copy.ts`。

**二重登録を防ぐ拠り所は2つ。** 片方だけでは足りない。

- `ZaimCopiedEntry` … 複製した元明細のidを残す。同じ元明細は二度対象にしない
- コメントの印（`Asset Manager 複製 #<元id>`） … **複製して作った明細を、さらに複製元として拾わない**。
  複製先が別ルールのコピー元になっていると、印が無ければ明細が無限に増える

内訳が決まっていない明細は複製できない（Zaimの支出登録がカテゴリ・内訳を必須にするため）。
その行は数えて画面に出すので、内訳の提案で決めてから複製し直す。

### 実行前プレビュー（Issue #286）

「いま複製する」を押すと、まず対象の明細を一覧で出す（`components/receipts/copy-preview-dialog.tsx`）。
**この読み込みではZaimへ一切書き込まない。** 書き込むのは一覧を確認して「確認して実行」を押したときだけで、
途中でやめれば何も残らない。

チェックを外した明細の複製元idは `runCopyRulesAction({ skipMoneyIds })` へ渡す。
**DBには残さない**（`ZaimCopyRule` にも `ZaimCopiedEntry` にも列を足していない）。次に開けば全件が
チェック済みに戻るので、「押せば全部複製される」という従来の既定は変わらない。

**プレビューと実行は `collectCopyCandidates` を共有する。** 別々に対象を選ぶと、画面に出したものと
実際に書き込むものがずれる。プレビューから実行までのあいだにZaim側の明細が変わっても、実行時に
集め直すので、消えた明細・複製済みになった明細はそのとき自動的に外れる。

実行結果は複製できなかった理由で分けて数える。`skipped` が内訳未設定、`excluded` が画面で外したぶん。

**Gmail取り込み直後の自動コピー（`onlyAuto`）はプレビューを挟まない。** 確認する相手がいないため。

**「自動」は定期実行ではない。** 「Zaim連携明細を取り込む」「Gmailを取り込む」を押した直後に、
自動に設定したルールが続けて走る。PM2のcronは追加していないので、画面を開かない日は何も起きない。

## Gmailから明細を作る（Issue #271）

「設定」タブに差出人・件名の条件を登録し、「Gmailを取り込む」で実行する。
検索式の組み立てと本文のテキスト化は `lib/gmail-query.ts`、API呼び出しは `lib/gmail-api.ts`。

```
「Gmailを取り込む」
  └ 条件から検索式を作る（from: / subject: / 追加語 / newer_than）
      └ 取り込み済みのメッセージidを除く（GmailImportedMessage）
          └ 本文を取り出す（text/plain を優先し、無ければHTMLをテキスト化）
              └ AIで明細化（analyzeReceiptMail）
                  └ ReceiptImport（source=GMAIL）を作る → 以降は既存の確認・確定・登録と同じ
```

- **どのメールを読むかはAIに決めさせない。** 条件に合うメールしか取得しない。関係の無いメールから
  明細を作ると、家計簿に存在しない支出が生まれるため
- 購入・決済のメールでなければ `totalAmount` が null で返る。その場合も「取り込み済み」として
  記録するのは、同じメールを毎回AIへ投げ直さないため
- 検索語は二重引用符で囲む（`quoteSearchTerm`）。Gmailの検索式は空白をANDとして扱うため、
  `ご利用のお知らせ` をそのまま入れると別々の条件に割れる
- 1回の取り込みで読むのは50通まで（`GMAIL_MAX_MESSAGES`）。条件を広く書いたときの暴走を止める
- スコープは `gmail.readonly` だけ。**既読・ラベル・削除には触れない**

### リフレッシュトークンの取得手順

OAuth 2.0 の同意はブラウザでしか完了できず、このサーバーにはGUIが無い。
そのため `scripts/zaim-oauth.ts` と同じ「URLを表示 → 手元のブラウザで許可 → 戻り先URLを貼る」形にしている。

```bash
# 1. Google Cloudで Gmail API を有効にし、種類「デスクトップアプリ」のOAuthクライアントIDを作って
#    GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET を .env へ書く
# 2. 認可フローを実行する（表示されたURLを手元のブラウザで開く）
npx -y tsx --env-file-if-exists=.env scripts/gmail-oauth.ts
# 3. 表示された1行を .env へ貼る
# 4. 接続を確かめる
npx -y tsx --env-file-if-exists=.env scripts/gmail-oauth.ts --check
```

**種類は「ウェブアプリケーション」ではなく「デスクトップアプリ」を選ぶ。** 戻り先URLの登録が要らず、
GUIの無いサーバーでも手順が短くなる。リフレッシュトークンは初回の同意でしか返らないため、
認可URLには `access_type=offline` と `prompt=consent` を付けている。
