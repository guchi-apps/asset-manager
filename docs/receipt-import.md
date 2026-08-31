# レシートAI取込 → Zaimカード明細の置き換え

Issue #153。レシート画像をAIで構造化し、Asset Manager側で確認・修正してから
**請求元の自動連携クレジットカードへ、品目付きで登録する**。統合そのものはZaim標準の
「置き換え」（スマートフォンアプリ限定）に任せる。

**登録先とその経路はIssue #302で変わった。** 以前は「反映待ち」口座へZaim APIで登録していたが、
APIで作った明細は置き換え候補にならないことが #300 の実測で分かったため、
**AIDE経由でZaim Web版（my.zaim.net）の入力画面へ登録する**形にしてある
（後述「Zaimへの登録」「置き換えの成立条件と検証」）。

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
- **統合はZaim標準の「置き換え」を使う。** Asset Managerは登録までを担い、削除も統合もしない
- **登録に失敗してもZaim APIでの登録へ落とさない（#302）。** API登録は置き換えに載らないため、
  落とすと「登録されているのに置き換えられない明細」が静かに増える。失敗は失敗のまま
  `MANUAL_ACTION_REQUIRED` で止め、人がZaimを見てから続きを送る
- 評価額の取得も支出の登録もAIDE経由。Zaimのログイン状態とPlaywrightはAIDEにしか無い（#191・#302）

## なぜ支出の登録もAIDE経由になったのか

以前は「登録した明細のidが要る」「途中で失敗したら消せる必要がある」という2つを理由に、
支出の登録だけZaim APIを直接使っていた。**#300 でその前提が崩れた。**

- **APIで作った明細は置き換え候補にならない。** 品目・出金元・日付・金額をまったく同じにしても、
  Web版の入力画面で作った明細だけが候補に並ぶ（後述の検証）。idが取れても置き換えに載らなければ意味がない
- **巻き戻しも成り立たない。** 置き換え前のカード連携明細はAPIから見えないため、
  「登録したものを消して整合を取る」という手順自体が置き換えの世界では通らない

そのため登録経路をWeb版の入力画面へ移し、Playwrightとログイン状態を持つAIDEへ委ねた
（`lib/zaim-web-payment.ts` → AIDEの `POST /api/zaim/payment/web`。aide#214）。
**Zaim APIは残っている**が、用途はマスタの取得・連携明細の取り込み・内訳の書き戻しだけになった。

## データの流れ

```
撮影/選択
  └ storage/receipts/<userId>/<YYYY-MM>/<sha256>.<ext> へ保存（DBにはパスとハッシュだけ）
      └ Claude API で構造化抽出（店舗・日時・商品・数量・単価・値引き・税・総額・信頼度）
          └ 商品分類履歴（ProductClassificationRule）でAIの分類を上書き
              └ 検算（明細合計 vs 総額）→ 高信頼なら CONFIRMED、それ以外は REVIEW_REQUIRED
                  └ 画面で確認・修正 → 確定（触った分類を履歴へ保存）
                      └ AIDE経由でZaim Web版へ商品ごとに登録（出金元＝請求元カード）→ SENT_TO_ZAIM
                          └ Zaimアプリで人が「置き換え」→ 画面で記録 → REPLACED
                              （途中で止まったら MANUAL_ACTION_REQUIRED。人が確認して続きを送る）
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
| `AIDE_ZAIM_WRITE_SECRET` | **Web版登録（#302）に必須。** AIDE側の同名の値。`AIDE_READ_SECRET` とは別物 |
| `AIDE_BASE_URL` | 任意。未設定なら `http://127.0.0.1:3114` |
| `ZAIM_CARD_ACCOUNT_ID` | 既定の請求元クレジットカードの `account_id`。取り込みごとに画面で変えられる |
| `ZAIM_PENDING_ACCOUNT_ID` | **登録先ではなくなった（#302）。** `scripts/zaim-replace-probe.ts` でのみ使う |
| `ZAIM_OAUTH_CALLBACK_URL` | 任意。既定は `http://localhost:9153/zaim/callback` |
| `ZAIM_SMART_RECEIPT_ACCOUNT_ID` | 任意。未設定なら口座名から自動判定 |
| `ZAIM_AMAZON_ACCOUNT_ID` | 任意。未設定なら口座名から自動判定 |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` | Google Cloudで発行（種類は「デスクトップアプリ」） |
| `GMAIL_REFRESH_TOKEN` | `scripts/gmail-oauth.ts` で取得 |
| `GMAIL_OAUTH_REDIRECT_URI` | 任意。既定は `http://localhost:9271/gmail/callback` |

**Zaim・Anthropic・Gmailのキーと `AIDE_ZAIM_WRITE_SECRET` はGitHub Secrets経由では配っていない。**
`.github/secrets-manifest.tsv` に載っているのはデプロイに要る値だけで、これらは本番VPSの `.env` へ
直接置く運用になっている（#221）。`deploy.yml` の `sync_env_var` は既存の行を消さないため、
デプロイしても残る（`AIDE_READ_SECRET` だけは評価額の取得に要るのでSecrets経由で配っている）。

`ZAIM_SYNC_USER_EMAIL` に設定したユーザーだけが画面を使える（既存のZaim連携と同じ認可。`lib/zaim-access.ts`）。

### アクセストークンの取得手順

OAuth 1.0a の認可はブラウザでしか完了できず、このサーバーにはGUIが無い。
そのため「URLを表示 → 手元のブラウザで許可 → 戻り先URLを貼る」形にしている。

```bash
# 1. https://dev.zaim.net/ でアプリを登録し、コンシューマキー/シークレットを .env へ書く
# 2. 認可フローを実行する（表示されたURLを手元のブラウザで開く）
npx -y tsx --env-file-if-exists=.env scripts/zaim-oauth.ts
# 3. 表示された2行を .env へ貼る
# 4. 請求元クレジットカードの id を調べて ZAIM_CARD_ACCOUNT_ID に設定する
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

## Zaimへの登録（Issue #302でAIDE経由のWeb版登録へ切り替えた）

確定したレシートを、**商品ごとに1件ずつ**、AIDE経由でZaim Web版の入力画面へ登録する
（`lib/zaim-web-payment.ts` → AIDEの `POST /api/zaim/payment/web`）。
内訳を残すことがこの機能の目的なので、1件に丸めない。

- **出金元は請求元の自動連携クレジットカード。** 置き換えの成立条件そのものにあたる。
  既定は `ZAIM_CARD_ACCOUNT_ID` で、**取り込みごとに画面で選び直せる**。選んだカードは
  `ReceiptImport.zaimAccountId` に残す（この列の意味は「反映待ち口座」から変わった）
- `name` に商品名、`place` に店舗名、`comment` に `Asset Manager レシート取込 #<id>` を入れる
- 冪等キーは `asset-manager:receipt-item:<ReceiptItem.id>`。同じキーの再送はZaimへ送られない
- 登録できた行には `ReceiptItem.zaimRegisteredAt` を必ず立てる。**Web版登録は `money.id` を
  返せないことがある**ため、idの有無で「登録済みか」を判定してはいけない
- 登録済み（`SENT_TO_ZAIM` / `REPLACED`）のレシートは編集も削除もできない

### 失敗したら止める。フォールバックしない

- **途中で失敗しても巻き戻さない。** 削除にはmoney idが要るが、Web版登録はidを返せないことがある。
  「消したつもりで消えていない」状態を作るより、登録済みの行を残したまま止めるほうが安全
- **Zaim APIでの登録へ落とさない。** API登録は置き換えに載らないので、落とすと
  「登録されているのに置き換えられない明細」が静かに増える
- 失敗したレシートは `MANUAL_ACTION_REQUIRED` になり、どこまで登録できたかを
  `ReceiptImport.zaimRegisterError` に残す。**編集も削除もできない**（Zaimに残った明細と食い違うため）
- 人がZaimを確かめたら「続きを登録」で再送する。`zaimRegisteredAt` が立っている行は送らない
- **画面要素の不一致（422 `rejected`）は成功として扱わない。** Zaimの仕様変更を検知する口になる

### AIDE側との取り決め（aide#214）

`lib/zaim-web-payment.ts` が呼ぶのは1本だけ。既存の登録API（`POST /api/zaim/payment`）に
形を合わせてある。

| | |
| --- | --- |
| パス | `POST {AIDE_BASE_URL}/api/zaim/payment/web` |
| 認証 | `Authorization: Bearer $AIDE_ZAIM_WRITE_SECRET` |
| 本文 | `requestId` / `date` / `amount` / `name` / `place` / `categoryId` / `genreId` / `fromAccountId` / `comment` |
| 応答 | `{ ok: true, moneyId: number \| null, duplicated: boolean, requestId }` |
| 失敗 | 400 invalid / 401 / 409 conflict / 422 rejected / 502 / 503（AIDE側 `statusFor` と同じ割り当て） |

- **409（`conflict`）だけは機械が送り直さない。** 前回の登録が成立したか分からない状態なので、
  人がZaimを見て決める（`ZaimWebPaymentError.retryable` が false）
- 待ち時間は180秒。読み取りAPI（10秒）と違い、ヘッドレスブラウザでログイン・入力・保存まで進む
- **`AIDE_BASE_URL` の向き先はAIDE側の実装に依る。** Zaimの巡回はサブPCのworkerでしか動かない
  一方、asset-manager と本番のAIDEサーバーはVPSにいる（AIDEの `README.md`「重い処理はworker、
  読むのはサーバー」）。VPSのAIDEが同期で捌けない作りになった場合は、`AIDE_BASE_URL` を
  受け口のある側へ向ける必要がある

### 状態（`ReceiptStatus`）

| 状態 | 意味 |
| --- | --- |
| `CONFIRMED` | 確定済み。カードへ登録できる |
| `SENT_TO_ZAIM` | カードへ登録済み。Zaimアプリでの置き換え待ち |
| `REPLACED` | 置き換えが済んだと**人が記録**した（機械では確かめられない。後述） |
| `MANUAL_ACTION_REQUIRED` | 登録が途中で止まった。人がZaimを見るまで進めない |

### money idはINTに収まらない（Issue #281）

Zaimの明細id（`money.id`）は2026-08時点で **約 1.02×10^10**（例: `10212021703`）まで伸びており、
MySQLのINT（上限 `2147483647`）には収まらない。INTの列へ入れると取り込みが必ず
`Out of range value for column 'zaimMoneyId'` で落ちる。

- money idを保存する列は**すべて`BigInt`（BIGINT）**にする。対象は
  `ReceiptImport.zaimMoneyId` / `ReceiptItem.zaimMoneyId` / `ReceiptItem.sourceZaimMoneyId` /
  `ZaimGenreSuggestion.zaimMoneyId` / `ZaimCopiedEntry.sourceMoneyId` / `ZaimCopiedEntry.copiedMoneyId`
- 口座id・カテゴリid・内訳idは別系統で、実測の最大が 6,679万なのでINTのままでよい
- アプリ側は`number`で持ち回す。Prismaは`BigInt`列を`bigint`で返すので、DBから出たところで
  `lib/zaim-money-id.ts` の `toMoneyIdNumber` / `toMoneyIdNumberOrNull` を通す。
  `bigint` のままサーバーアクションの戻り値へ載せるとJSONにできず落ちる
  （値は `Number.MAX_SAFE_INTEGER` に対して5桁以上の余裕がある）
- 書き込みはPrismaが`number`をそのまま受け取るため、変換は要らない

## 置き換え待ち（旧「置き換え候補」。Issue #302で作り直した）

**「置き換え候補」は廃止した。** 直近70日の支出をZaim APIから取って照合していたが、
**置き換え前のカード連携明細は公開APIから見えない**（後述の #300 の実測）。
APIから引ける明細は、すでに置き換え済みか手入力済みのものだけで、
提示していた「候補」は置き換えの相手ではなかった。

- `lib/receipt-match.ts`（スコアリング）・`ReceiptMatchCandidate` テーブル・
  「置き換え候補を更新」ボタン・候補の却下（「違う」）は**すべて削除した**
- 代わりに、`SENT_TO_ZAIM` のレシートを**「カードへ登録済み・置き換え待ち」として並べ、
  Zaimアプリで的を探すのに要る値（カード・日付・金額・店舗）を出す**だけにした
- 置き換えが済んだら、画面の「置き換え済みにする」で `REPLACED` を記録する

**機械が置き換えの成否を判定することはできない。** 置き換えの操作はスマートフォンアプリ限定で、
置き換え前の明細はAPIから見えず、置き換え後にどの明細が何に変わったかも追えない。
自動削除・自動統合も行わない。

## 置き換えの成立条件と検証（Issue #300）

置き換えが成立する条件は公式情報だけでは確定しないため、実際のZaimアカウントで確かめる。
判定の組み立ては `lib/zaim-replace-probe.ts`、実行は `scripts/zaim-replace-probe.ts`。

### 置き換え前のカード連携明細は、公開APIから見えない

**`GET /v2/home/money` が返すのは、利用者が手入力した明細と置き換え済みの明細だけ。**
まだ置き換えていないカード連携明細は返らない。2026-08-31 に実測した（アプリに見えている
「2026-08-27 / 550円 / 東テスティバル」が、同期間の支出414件のどこにも無かった）。
AIDEの `README.md`「取得は巡回、登録は公式API」にある「Zaim APIで扱えるのは利用者が
手入力したレコードだけ」と一致する。

**この事実は既存機能にも効いた。** かつての「置き換え候補」が直近70日の支出から
探していたのは、**すでに置き換え済み・手入力済みの明細**であって、置き換え待ちのカード明細ではない。
そのため #302 でこの機能そのものを取りやめた（前述「置き換え待ち」）。

見分けが紛らわしいのは、**置き換えが済んだ明細はカード口座に残る**こと。1件の連携明細が
レシートの商品行そのものへ置き換わるため、同じ日・同じ店の明細が何件も並び、その中には
品目が空のものも混ざる。品目の有無だけでは素の連携明細と区別できない
（#300 の初回検証は、置き換え済みのサンディの商品行10件のうち品目が空の1件を的にして空振りした。
1件の連携明細 ¥4,855 が商品行10件になっていた）。

### 機械では結論が出ない

置き換えの最後の1手（アプリの「置き換え」ボタン）は**スマートフォンアプリ限定**で、公開APIにも
Web版にも無い（[公式手順](https://content.zaim.net/manuals/show/61) は iOS/Android の画面しか
示さない）。**的の指定も結果の確認も人が画面を見て行う**。コマンドにできるのは、候補として出るはずの
明細を条件違いで用意するところまで。

公式が挙げる条件は次の3つで（[残高のずれについて](https://content.zaim.net/questions/show/956)）、
**作成経路（API / Web版 / アプリ）を条件とする記述は見当たらない**。

- レシート撮影、または「常に品目を入力する」をオンにして記録した明細であること
- 出金元として、自動連携したクレジットカード・電子マネーが指定されていること
- 記録の金額と自動取得した金額が同じであること

置き換えられる側は連携カード・電子マネーの明細に限られ、**銀行口座・デビットカード・
ショッピングサイトの連携明細は対象外**（[対象となる履歴](https://content.zaim.net/questions/show/953)）。

### 検証の結果（2026-08-31）

当時の実装は品目を入れているが**出金元が「反映待ち」口座**だったので、作成経路より先にそこを疑った。

| | 内容 | 結果 |
| --- | --- | --- |
| A | 反映待ち口座＋品目ありのAPI明細（当時の実装と同じ） | **候補に出ない** |
| B | 連携カード口座＋品目ありのAPI明細（Aから出金元だけを変えたもの） | **候補に出ない** |

的にしたのは 2026-08-27 / 550円 のカード連携明細で、アプリの「置き換え」を開いても
A・Bのどちらも候補に並ばなかった。

さらに、**Zaim Web版（my.zaim.net）で同じ条件を手入力した明細は候補に出た**（同日に確認）。

**分かれ目は作成経路で、条件の中身ではない。** 品目・出金元・日付・金額がまったく同じでも、
Zaim APIの支出登録で作った明細は候補にならず、Web版の入力画面で作った明細は候補になる。
レシート撮影・品目入力で作った明細にはZaim側で内部的な印が付き、**APIの支出登録ではそれが
付かない**、という理解になる。

| 作成経路 | 置き換え候補になるか |
| --- | --- |
| Zaim API（`POST /v2/home/money/payment`） | **ならない**（出金元を連携カードにしても） |
| Zaim Web版（my.zaim.net）の入力画面 | **なる** |
| アプリのレシート撮影・品目入力 | なる（公式の想定どおり） |

したがって「Asset Manager からZaim APIで先行登録し、カード明細が届いたら置き換える」という
当時の構成は**成立しない**。一方で、#300 の対応方針案（Web版の入力画面から登録する）は
**成立する**ことが確かめられた。

**この結論に沿って #302 で登録経路を差し替えた。** Zaimのログイン状態と巡回スクリプトを持つ
AIDE側へWeb版の入力を実装し（aide#214）、Asset Manager はそこへ登録内容を渡す
（前述「Zaimへの登録」・後述「Playwright基盤はこのリポジトリに無い」）。

### 検証の手順

```bash
# 1. 下見。登録する内容を表示するだけで、Zaimへ書き込まない
npx -y tsx --env-file-if-exists=.env scripts/zaim-replace-probe.ts \
  --card <カード口座id> --date 2026-08-27 --amount 550 --place "東テスティバル"
# 2. 条件違いの検証明細A・Bを登録する（同じ引数に --create を足す）
# 3. アプリでそのカード明細の「置き換え」を開き、候補にA・Bのどちらが出るかを見る
# 4. 実機確認のあと、検証明細を削除する
npx -y tsx --env-file-if-exists=.env scripts/zaim-replace-probe.ts --list
npx -y tsx --env-file-if-exists=.env scripts/zaim-replace-probe.ts --cleanup
```

- **`--date` / `--amount` はアプリの画面で読んだ値を渡す。** 置き換え前のカード明細はAPIから
  引けないので、的を機械に探させることはできない
- **`--card` を推測で決めない。** 出金元を間違えると関係のないカードの家計簿へテスト明細が入る。
  未指定のときは支出の多い口座を挙げて止まる
- **その日付・金額の明細がすでにAPIから見えていたらエラーで止める。** 見えているなら手入力済みか
  置き換え済みの明細で、置き換え前の連携明細ではない
- カテゴリ・内訳は置き換えの条件に関係しないため、家計簿で最も使われている組を借りる
  （`--category` / `--genre` で上書きできる）
- 検証明細はコメントの印（`Asset Manager 置き換え検証 #300`）で見分ける。`--cleanup` はこの印が
  付いた明細だけを消すので、家計簿の他の明細には触れない
- 前回の検証明細が残っている状態では `--create` しない。候補が入り混じって比較にならない

### Web版の品目入力が候補になることの確かめ方

2026-08-31 に次の手順で確認した。Web版の入力もアプリの置き換えも画面操作なので、
コマンドでは確かめられない。Zaimの仕様が変わったと疑うときは同じ手順で引き直す。

1. Zaimアプリで、**まだ置き換えていないカード連携明細**を1件選び、日付・金額・カードを控える
2. my.zaim.net で支出を1件手入力する。**日付と金額を1で控えた値に合わせ、品目を必ず入れ、
   出金元にそのクレジットカードを指定する**
3. アプリで1の明細を開き、「置き換え」に2で作った明細が候補として並ぶかを見る
   → **並んだ**
4. 確かめたら、2で作った明細を削除する（置き換えは実行しない）

同じ的に対してZaim APIで作った明細（`scripts/zaim-replace-probe.ts` のA・B）は並ばなかった。
**この2つを同じ条件で並べて比べることが、作成経路が分かれ目だと言える根拠になる。**

### Playwright基盤はこのリポジトリに無い

Zaimのログイン状態（storage state）と巡回スクリプトはAIDE（`src/core/connectors/zaim/`）にあり、
**サブPCのworkerでしか動かない**。Asset Manager 本体はVPSで動くため、Web版の品目入力は
AIDE側への実装が要り、このリポジトリだけでは完結しない（`docs/zaim-auto-sync.md` の「責務の分担」）。

**したがって、このリポジトリが持つのはHTTPの呼び出しと失敗の分類だけ**にしてある
（`lib/zaim-web-payment.ts`）。画面のどの入力欄をどう埋めるかはAIDE側の知識で、
こちらへ持ち込まない。Zaimの画面が変わったときに直す場所も、AIDE側の1か所だけになる。

## スマートレシート・Amazon由来の明細（Issue #222）

Zaimへ連携済みのスマートレシート・Amazonの明細を取り込み、内訳を補正してから
請求元のカードへ登録する。画像が無いだけで、確認・確定・登録の流れは撮影したレシートと同じ。

```
「Zaim連携明細を取り込む」
  └ GET /v2/home/money（直近60日・payment）
      └ from_account_id が連携口座のものだけ残す
          └ 由来口座・日付・店舗名でまとめて取り込み1件にする
              └ 内訳を補正（Zaimの分類 → 商品分類履歴 → AI）
                  └ 全商品が履歴で決まったものだけ CONFIRMED、それ以外は REVIEW_REQUIRED
                      └ 確定後、カードへ登録（一覧の「まとめて『<カード名>』へ登録」）
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
| 決済日ずれ | 取り込みでは吸収しない。置き換えの的はZaimアプリの画面で人が選ぶ |

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
- 同じ日・同じ店の明細があとから増えた場合は、まだZaimへ送っていない取り込みへ足す
  （`ReceiptImport.sourceKey`）。Zaimへ登録し始めた取り込み（`SENT_TO_ZAIM` / `REPLACED` /
  `MANUAL_ACTION_REQUIRED`）へ足すと登録済みの明細と食い違うため、その場合は連番を付けた別の取り込みにする
- Zaimで**集計対象外にした明細（`active` が 0）は取り込まない。** 置き換えを済ませた元明細を拾い直さないため

### 触らないもの

**Zaim側の元明細には一切手を触れない。** 削除も、集計対象外への変更もしない。
カードへ登録したあと、元のスマートレシート・Amazon明細を集計対象外にする操作は
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
これまで手で行っていた「スマートレシート・Amazonの明細を別の口座へコピーする」作業がこれにあたる。
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

## ChatGPT/AIDEから請求情報を取り込む（Issue #290）

ChatGPTスケジュールはZaim APIを直接呼ばず、`POST /api/receipts/import`へ請求情報を送る。
認証は既存の自動実行APIと同じ`Authorization: Bearer <ZAIM_SYNC_SECRET>`で、対象ユーザーは
`ZAIM_SYNC_USER_EMAIL`から解決する。入力例は次のとおり。

```json
{"source":"gmail","gmailMessageId":"18c...","threadId":"18c...","date":"2026-08-30","amount":1490,"place":"Netflix","name":"Netflix","accountHint":"楽天カード","rawSubject":"ご利用のお知らせ","rawSender":"billing@example.com","confidence":0.95,"sourceMetadata":{"scheduleRunId":"..."}}
```

同じユーザーの`gmailMessageId`は`GmailImportedMessage`の一意制約で管理する。再実行時は
`duplicate`を返し、既存の`receiptId`を返すため、初回だけがZaimへ登録される。分類履歴に一致し、
**請求元のクレジットカードを特定でき**、信頼度が十分な入力は`imported`、それ以外は`pendingReview`として
通常の`/receipts`確認画面へ残る。対象ユーザーが見つからない場合や入力不正は`error`を返す。

### 使用量を品名へ入れる（Issue #307）

関西電力のような公共料金の請求は、品名が「電気料金」だけだと**何kWh・何㎥ぶんの請求だったのかが
Zaimに残らない**。任意の`usage`に使用量を入れて送ると、品名の末尾へ足して登録する。

```json
{"source":"gmail","gmailMessageId":"18d...","date":"2026-08-20","amount":7842,"place":"関西電力","name":"電気料金","usage":"258kWh","accountHint":"楽天カード","confidence":0.95}
```

上の入力は品名「電気料金 258kWh」として登録される。

- **単位の表記はasset-manager側で1つに寄せる**（`formatUsageLabel`）。`m3`・`m³`・`立方メートル`は`㎥`へ、
  `KWH`は`kWh`へ揃え、`258 kWh`のように空いた数値と単位は詰める。送り手ごとに書き方が違うと、
  同じ請求が別の品名でZaimに並ぶため
- **分類履歴のキーは`usage`を含まない`name`から作る。** 「電気料金 258kWh」をそのままキーにすると
  毎月別の商品になり、一度決めた内訳が二度と当たらなくなる。`normalizeProductName`も使用量を
  落とすので、`name`に直接「電気料金 258kWh」と書いて送っても同じキーになる
- **使用量が読み取れなかった月は`usage`を省く。** 推測した数値を足すと、Zaimに残る品目が請求書と
  食い違う。省いたときは品名だけで登録される
- 1メール＝1明細のため、電気とガスが1通のメールに載る場合は片方しか登録できない
  （`gmailMessageId`が重複判定のキーであるため）

`accountHint`には**請求元のカードのZaim口座名**を入れる（#302）。一致する口座があればそのカードへ登録する。
**一致しなかったときは既定のカードへ落とさず`pendingReview`にする** — 違うカードへ登録すると置き換えの的が
合わないため。`accountHint`を省いたときだけ`ZAIM_CARD_ACCOUNT_ID`のカードを使い、それも無ければ`pendingReview`になる。

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
