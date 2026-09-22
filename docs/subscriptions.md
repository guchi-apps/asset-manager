# サブスク管理

サブスク管理アプリ（`guchi-apps/subscription-lists`）から、サブスク一覧・金額・更新日の機能を
移管したもの（Issue #491）。画面は `/subscriptions`、AIDE向けの読み出しは
`GET /api/subscriptions`。既存データは #492 で取り込み済みで、元のアプリの停止・撤去は
#493（実行手順は #543）で進めている。

**移していない機能**: 支払予定日のカレンダー、契約のタイムライン、クレジットカード台帳、
年間利用額ボーナスの進捗。Issue #491 で「不要」とされたため、モデルごと持ち込んでいない。
**ただし移行元の `CreditCard`（台帳）は 2026-08-19 に移行元で削除済み**（migration `remove_credit_card`）で、
移行元の「カード」画面（`/card`）の実体は年間利用額ボーナスの進捗（`BonusPeriod` / `BonusSpendEntry`）。
この記録は移行元のDBを消すと失われるため、撤去の前に要否を確かめる（#543の手順2）。

## データの持ち方

| モデル | 役割 |
|---|---|
| `Subscription` | 契約そのもの（名前・区分・契約開始日／終了日・メモ）。支払い方法・料金の列は持たない |
| `SubscriptionPrice` | 料金の変更履歴。「いつから いくら」を複数持つ。プラン名（`planName`）と変更理由（`memo`）は別の欄 |
| `SubscriptionPaymentMethodHistory` | 支払い方法の変更履歴。「いつから どれ」を複数持つ（Issue #517） |
| `SubscriptionPaymentMethod` | 支払い方法の選択肢。引き落とし先のZaim口座（`zaimAccountId` / `noZaimAccount`）もここに持つ（Issue #566） |
| `SubscriptionLabel` / `SubscriptionLabelLink` | ラベルの辞書と、サブスクとの対応 |

### 区分（`Subscription.category`、Issue #512）

継続的な支出をすべて「サブスク」として数えると、保険・税金・端末分割払いが純粋なサブスクの件数・合計に
混ざる。契約に区分を持たせ、集計を分ける。**区分は必ずどれかに属し（NOT NULL・既定 `SUBSCRIPTION`）、
未分類の状態は持たない。**

| 値 | 表示名 |
|---|---|
| `SUBSCRIPTION` | サブスクリプション |
| `INSURANCE` | 保険・共済 |
| `TAX` | 税金・年次支出 |
| `INSTALLMENT` | 分割払い |
| `OTHER_FIXED_COST` | その他固定費 |

- **「サブスク合計」は `SUBSCRIPTION` だけ。** `SubscriptionSummary` の `monthlyTotalJpy` / `yearlyTotalJpy` /
  `activeCount` / `scheduledToEndCount` / `endedCount` がこれ。**#512 より前は全契約の集計だったので、
  値の意味が変わっている**（区分がすべて `SUBSCRIPTION` のうちは同じ値）
- **保険・税金・分割払いを含む全体は「月額固定費」**（`fixedCostMonthlyTotalJpy` / `fixedCostYearlyTotalJpy` /
  `fixedCostActiveCount`）。区分ごとの件数・月額換算は `byCategory`。どちらも `lib/subscription-category.ts` の
  `summarizeByCategory` から作る。解約済みは含めず、解約予定は含める（区分に関係なく同じ）
- 「次の更新」は全区分から選ぶ（保険料や税金も請求日は知りたいため）
- 画面の一覧は区分のチップ（件数・月額つき）で絞り込む。区分は登録・編集ダイアログで変更する

**既存データの移行**: `prisma/migrations/20260921000000_add_subscription_category` が列を足すと既存の契約は
すべて `SUBSCRIPTION` になり、続けて次の6件を**名前の完全一致**で移す。表記が違えば `SUBSCRIPTION` のまま
残るので、画面の編集から区分を変える（本番DBへは実装エージェントが接続できず、名前は事前に確認していない）。

| 名前 | 区分 |
|---|---|
| iPhone15 | `INSTALLMENT` |
| 自動車税 | `TAX` |
| グループ生命共済・スマホ保険・火災保険・日常生活賠償安心 | `INSURANCE` |

### 金額は「いま いくら」ではなく「いつから いくら」で持つ

`Subscription` に金額の列は無く、`SubscriptionPrice` を最低1件持つ。値上げは**上書きではなく
履歴の追加**で表す（編集ダイアログに金額欄が無いのはこのため。追加は詳細ダイアログから行う）。
履歴の1件そのものの直し（入力ミス・プラン名の付け足し・適用開始日の修正）は、詳細ダイアログの行の
編集ボタンから行う。編集の中から削除もできるが、**料金は1件以上必要なので最後の1件は消せない**
（`deletePrice`）。適用開始日の重複は自分自身を除いて確認する（`updatePrice`）（Issue #525）。

表示に使う料金は `getCurrentPrice(prices, referenceDay)` が決める。`referenceDay` は通常は今日だが、
**解約済みのサブスクだけは契約終了日**を使う。今日で引くと、解約後に足した改定が過去の契約に
出てしまうため（`lib/subscription-service.ts` の `toView`）。

### 支払い方法も「いま どれ」ではなく「いつから どれ」で持つ（Issue #517）

料金と同じ理由・同じ形で、`Subscription` に支払い方法の列は無く、`SubscriptionPaymentMethodHistory`
を最低1件持つ。契約作成時に、契約開始日を適用開始日とする最初の履歴が自動で作られる
（`createSubscription`）。表示に使う支払い方法は `getCurrentEntry(paymentMethodHistory, referenceDay)`
（`getCurrentPrice` と同じ選び方を、`effectiveFrom` だけを見る汎用形にした関数）が決める。

**編集ダイアログには支払い方法の欄がそのまま残っている**（料金と違い、詳細ダイアログの履歴からしか
変更できない作りにはしていない）。ここで支払い方法を変えて保存すると、内部で「今日を適用開始日と
する履歴」を追加・更新する（`updateSubscription` → `recordPaymentMethodChangeIfNeeded`）。同じ日に
何度変えても、その日の履歴を書き換えるだけで重複エラーにはならない。過去に遡って直す・変更理由や
根拠を残すような変更は、詳細ダイアログの「支払い方法の変更履歴」から明示的に追加・編集する
（`addPaymentMethodHistory` / `updatePaymentMethodHistory` / `deletePaymentMethodHistory`。
`addPrice` / `updatePrice` / `deletePrice` と同型で、適用開始日の重複禁止・最後の1件は削除不可も同じ）。

支払い方法マスタ（`SubscriptionPaymentMethod`）の「使用中の件数」（`listPaymentMethods` の
`subscriptionCount`）は、履歴の行数ではなく**使っているサブスクの数**（同じサブスクが履歴を
何度も持っていても1件と数える）。削除できるかどうかの判定（`deletePaymentMethod`）も同じ考え方。

### 支払い方法とZaim口座の紐づけ（Issue #566）

支払い方法（三井住友カード・iTunes・給与天引き…）ごとに、**最終的に引き落とされるZaim口座**を持つ。
iTunes・Google Pay のようにZaimに口座が無い中継サービスは、中継先のカード口座を選ぶ。紐づけは
支払い方法マスタの側に持ち、サブスク・支払い方法の履歴はマスタを経由して口座を引く
（`lib/subscription-zaim-link.ts` の `resolveZaimLink`）。

| 状態（`ZaimLinkView.status`） | 列 | 意味 |
|---|---|---|
| `LINKED` | `zaimAccountId` に値 | Zaim口座に引き落とされる |
| `NO_ACCOUNT` | `noZaimAccount = true` | Zaim口座を通らない（給与天引き・請求書など） |
| `UNSET` | どちらも空 | まだ決めていない。設定タブに件数を出す |

- **口座は名前ではなくZaimの `account_id` で持つ。** 口座名は保存せず、表示のたびに `ZaimAccount`
  （Zaimマスタのキャッシュ）から引くので、Zaimで口座名を変えても紐づけは外れない（マスタの取り直しで名前が追従する）
- 選べるのは `ZaimAccount` に取り込み済みで有効な口座だけ。マスタはレシート画面の「Zaimのマスタを更新」で取り込む。
  Zaimで口座が無効になっても紐づけは残し、「Zaimで無効」と表示する
- **紐づけは期間を持たない。** iTunesの引き落とし先カードを変えると、過去の履歴も新しい口座で数えられる。
  期間ごとに変えたい場合は、支払い方法を分けて（例: 「iTunes（ANAカード）」）履歴で切り替える
- 口座ごとの集計は `SubscriptionSummary.byZaimAccount`（全区分・解約済みを除く・月額の大きい順）。
  `NO_ACCOUNT` と `UNSET` もそれぞれ1行にまとまる
- Zaim口座を主にして支払い方法をぶら下げる案は採らなかった。給与天引きなどが口座に属さず例外が要り、
  #517 の支払い方法の履歴も作り直しになるため

### 日付は `Date` ではなく `YYYY-MM-DD` の文字列で持ち回る

契約開始日・支払日・適用開始日は時刻を持たない値で、`new Date("2026-09-11")` はUTCの0時として
解釈されるためJSTで表示すると `09:00` が付く（#443）。`lib/subscription-billing.ts` は
`DayKey`（`YYYY-MM-DD`）で計算し、DBとの境界だけで `toDayKey` / `fromDayKey` を通す。

**`@db.Date` の値は必ずUTCのgetterで読む。** `toDayKey` がそれを行っている。

## 次回の更新日の決め方

`getNextOccurrence` は、今日から1ヶ月ずつ最大3年先まで「その月に支払いがあるか」を見て、
最初に見つかった日を返す。次の3つを同時に満たす必要があるため、単純な加算では出せない。

- **間隔**: `billingInterval` が2以上なら、料金の適用開始月（年）から数えて周期の合う月だけ
- **月末クランプ**: `billingDay = 31` の2月は28日（閏年は29日）に繰り上がる（`clampToLastDayOfMonth`）
- **料金改定またぎ**: その日に有効だった料金の周期で判定する（改定で毎月→毎年に変えた場合など）

契約終了日を過ぎた日は返さないので、**解約予定のサブスクは残りの支払いを出し切ると `null` になる**。
解約済み（`ENDED`）は最初から計算しない。

**終了日が未入力の解約予定で、自動更新もしない契約（`renewalStopped`）も `null`。** `getNextOccurrence` は
終了日が無いと先へ先へ探して見つけてしまい、更新されない契約に存在しない請求日（例: さくらの
メールボックスの2027-01-25）が出ていた（#513）。`lib/subscription-service.ts` の `toView` が、
この契約だけ `getNextOccurrence` を通さない。月あたりの合計にはこれまでどおり含める（まだ払っている）。
**自動更新のままの解約予定（終了日未入力）は次回の更新日を出す**（#525）。解約の手続きが済むまで請求は
続くため。以前は終了日が未入力の解約予定をすべて「更新なし」にしていた。

## 契約状況

**「更新方法」と「解約予定か」は別々に持つ**（Issue #525）。`Subscription.autoRenew`（自動更新か）と
`Subscription.cancelPlanned`（解約予定・検討中を含む）は独立で、4通りの組み合わせがすべてある。
以前は `autoRenew` だけで「終了日が未定なら、更新しない＝解約予定」と決めていたため、
「解約しないが自動更新ではない」契約と「解約しようとしているが自動更新のまま」の契約を記録できなかった。

| 更新方法（`autoRenew`） | 今後の予定（`cancelPlanned`） | 一覧のバッジ |
|---|---|---|
| 自動更新 | 継続する | 自動更新中 |
| 自動更新しない | 継続する | 自動更新なし |
| 自動更新 | 解約予定 | 解約予定 ＋ 自動更新のまま（終了日が未入力のときだけ） |
| 自動更新しない | 解約予定 | 解約予定 |

`getContractStatus(endDate, cancelPlanned, today)` の3値。**自動更新かどうかは見ない**。

| 値 | 条件 | 合計への算入 |
|---|---|---|
| `ENDED`（解約済み） | 終了日が今日より前 | 含めない |
| `SCHEDULED_TO_END`（解約予定） | 終了日が今日以降、または終了日が未定で `cancelPlanned = true` | **含める**（まだ払っている） |
| `AUTO_RENEWING`（継続中） | 終了日が未定で `cancelPlanned = false` | 含める |

- **`AUTO_RENEWING` は名前が「自動更新中」のままだが、自動更新でない継続も含む。** `status` の値は
  AIDE向けAPIに出ているため改名していない。表示名は `getContractStatusLabel(status, autoRenew)` が
  出し分ける（継続中で `autoRenew = false` なら「自動更新なし」）
- **終了日が入っていれば `cancelPlanned` によらず解約予定。** 編集画面は、終了日が入っている間
  「今後の予定」を解約予定で固定して見せる
- **AIDE経由の作成で `cancelPlanned` を送らないときは、従来どおり「終了日が未定で `autoRenew = false`」を
  解約予定にする**（`parseSubscriptionInput`）。画面は必ず明示して送る
- **既存データの移行**（`20260922000000_split_subscription_plan_and_cancel`）: 終了日が未定で
  `autoRenew = false` だった契約を `cancelPlanned = true` にして、表示を変えない

### 解約予定の終了情報（Issue #513）

解約予定（`SCHEDULED_TO_END`）は、日付を3つに分けて持ち回る（`getEndInfo` → `SubscriptionView.endInfo`）。
**列は増やさず、既存の `endDate` と料金履歴から導出する。**

| 項目 | 中身 |
|---|---|
| 契約終了日 | 入力された `endDate`。未入力なら `null`（＝要確認） |
| 最終請求日 | 最後に請求が発生する日。終了日が未入力なら、直近に請求された日 |
| 利用期限 | 終了日があればそれ。無ければ最終請求日の**支払い周期が終わる日（次の請求予定日の前日）の見込み**（`usableUntilIsEstimate = true`） |

**終了日が未入力の解約予定は `needsEndDate = true`**（自動更新かどうかによらない）で、画面は「終了日未入力」バッジと一覧上部の警告、
「該当のみ表示」の絞り込みを出す。API は `summary.needsEndDateCount` / `needsEndDateNames` と、
`GET /api/subscriptions?needsEndDate=1` で該当だけを返す。**通知（Signalyなどへの定期送信）は未実装**
で、いまは画面とAPIで拾えるところまで。

## プラン名は料金履歴の「プラン名」から表示する（Issue #513・#525）

ChatGPT・Claude Code のように月ごとにプランが変わる契約は、契約本体（`Subscription`）へ
プラン名を固定保存せず、**その期間の料金履歴のプラン名（`SubscriptionPrice.planName`）にプランを書く**。
一覧・詳細・API の `currentPlan` は、`getCurrentPrice` が選んだ「適用中の料金」のプラン名
（`SubscriptionView.currentPlan`）。過去のプラン変更は `priceHistory`（API・古い順）と詳細の
「料金・プランの変更履歴」で時系列に見られる。

**プラン名（`planName`、100文字まで）と変更理由（`memo`）は別の欄で、どちらも任意。** プラン名だけが
一覧の「プラン」に出て、変更理由は履歴の行にだけ出る。#525 より前は1つのメモ欄（`memo`）に両方を
書いていて、それが一覧の「プラン」になっていた。移行では、100文字以内のメモをプラン名へ移して
`memo` を空にした（一覧の表示を保つため）。**100文字を超えていたメモは長い変更理由とみなして `memo` に
残しているので、そのプランは一覧に出ない**（履歴の編集でプラン名を入れる）。

**解約済みの `currentPlan` は終了日時点の料金のもの**（`currentPrice` と同じ理由）。

## 外貨（USD）

`SubscriptionPrice.currency` は `JPY` / `USD`。円換算は `lib/exchange-rate.ts` が
frankfurter.app のレートを6時間キャッシュで引く。**取得できない場合は `null` を返し、
円換算の併記と合計への算入だけを落とす**（元の金額は必ず出す）。合計から外したサブスクは
`SubscriptionSummary.unconvertedNames` に載るので、画面とAPIの両方で「何件を外したか」が分かる。

円換算は**丸める前の金額で行う**。先に丸めると、少額のドルで換算結果が大きくずれる。

## AIDE向けの読み出しAPI

```
GET /api/subscriptions[?includeEnded=1]
Authorization: Bearer $ZAIM_SYNC_SECRET
```

- 認証・対象ユーザーの決め方は `/api/zaim/sync`・`/api/receipts/import` と同じ
  （`ZAIM_SYNC_SECRET` と `ZAIM_SYNC_USER_EMAIL`）。AIDE側に新しい設定は要らない
- 既定では解約済みを返さない。`includeEnded=1` で全件
- 金額は「1回あたり（`amount` / `currency`）」と「月あたり（`monthlyAmount` / `monthlyAmountJpy`）」の
  両方を返す。月あたりだけだと3ヶ月ごと・毎年払いの請求額が分からず、1回あたりだけだと合計が出せない
- 各契約に `category` / `categoryLabel` を含める。`summary.monthlyTotalJpy` などは**サブスク（`SUBSCRIPTION`）だけ**の
  集計で、全区分は `summary.fixedCost*`、内訳は `summary.byCategory`（上の「区分」を参照）
- `POST /api/subscriptions` は `subscription.category` を受ける。省略すると `SUBSCRIPTION`、
  知らない値は400（黙って直さない）
- AIDE側のMCPツール（`asset_manager_subscriptions`）はこのリポジトリの管理外だが、**APIのJSONを
  そのまま返す**ため、ここで足した項目（`category`・`currentPlan`・`priceHistory`・`endInfo`・`needsEndDate`）は
  MCPの出力にも出る。`needsEndDate` の絞り込み（クエリ）だけはツールの引数に無く、AIDE側の追加が要る。
  `asset_manager_create_subscription` は入力スキーマが `additionalProperties: false` のため、
  区分を指定して作るにはAIDE側の変更が別途要る
- `currentPlan` / `currentPlanSince`: いま適用中の料金履歴のプラン名と、その適用開始日
- `priceHistory`: 料金・プランの変更履歴（古い順）。`planName` がその期間のプラン名、`memo` が変更理由、`isCurrent` が適用中
- `paymentMethodHistory`: 支払い方法の変更履歴（古い順、Issue #517）。`paymentMethod` がその期間の支払い方法名、
  `memo` が変更理由・根拠、`isCurrent` が適用中。**読み出しのみで、AIDE側からの書き込み口（MCPツール）はまだ無い**
  （Gmail・Zaimを照合して自動反映する仕組みは別Issueで扱う）
- `zaimLink` / `zaimAccountId` / `zaimAccountName`: いまの支払い方法の引き落とし先のZaim口座（Issue #566）。
  `paymentMethodHistory` の各行にも同じ3項目がある。`summary.byZaimAccount` は口座ごとの件数・月額
- `autoRenew` / `cancelPlanned`: 更新方法と解約予定。`status` は終了日と `cancelPlanned` から決まり、`autoRenew` とは独立
  （`statusLabel` は継続中で `autoRenew = false` のとき「自動更新なし」）
- **AIDE経由で足した料金にはプラン名が付かない。** `asset_manager_add_subscription_price` は `memo` しか送らず、
  `memo` は変更理由として保存される。プラン名を付けるにはAIDE側のツールに `planName` を足す必要がある
  （`POST /api/subscriptions/[id]/prices` と `POST /api/subscriptions` は `planName` を受け付ける）
- `endInfo`: 解約予定のときだけ。`contractEndDate` / `lastBillingDay` / `usableUntil` / `usableUntilIsEstimate`
- `nextBillingDay` は、終了日が未入力で自動更新もしない解約予定では `null`（更新されない）

## subscription-lists からのデータ移行（Issue #492）

#491 では機能だけを移したので、既存のデータは**手で移行した**（本番への実行は #492 で済んでいる）。本番DBへ
接続するのは実装エージェントではなく利用者なので、手段（書き出しSQLと取り込みスクリプト）だけを用意していた。

**この節と移行スクリプト一式は、移行元のDBを消した後（#493・#543）に撤去する。** それまでは、移行元が残っている間の
やり直しの手段として置いている。撤去するのは `scripts/import-subscription-lists.ts`・`scripts/subscription-migration/`・
`lib/subscription-migration.ts`・`lib/subscription-migration.test.ts`。**テストの実行対象は `package.json` の `test` に
列挙してある**ので、消すときは列挙も同時に直し、実行件数（`ℹ tests <n>`）が、そのテストファイルの件数（2026-09-21時点で20件）ぶん減ったことを確かめる。

| モデルの対応 | 備考 |
|---|---|
| `PaymentMethod` → `SubscriptionPaymentMethod` | `displayOrder` → `order` |
| `Label` → `SubscriptionLabel` | 色はそのまま。移行元に並び順は無いので作成順に振る |
| `Subscription` → `Subscription` | `_LabelToSubscription`（暗黙の多対多）→ `SubscriptionLabelLink` |
| `SubscriptionPrice` → `SubscriptionPrice` | `Decimal(10,2)` → `Float` |

`BonusPeriod` / `BonusSpendEntry` / `CreditCard` は移さない。作成・更新日時は移行元のまま引き継ぐ。

### 手順

**1. 書き出し**（subscription-lists のDBへ接続できる場所で。読み取りだけ）

```bash
mysql --batch --raw --skip-column-names --default-character-set=utf8mb4 \
  -u <ユーザー> -p <subscription-lists のDB名> \
  < scripts/subscription-migration/export.sql > dump.ndjson
```

`--raw` を落とすと `\` が二重になりJSONが壊れる。出力は**1行1レコードのJSON**（`kind` で種類を区別）。
`dump.ndjson` には金額・メモが入るのでコミットしない（`*.ndjson` は `.gitignore` 済み）。**移行後は消す**。

**2. dry-run**（既定。DBへは何も書かない）

```bash
# ローカル（asset_manager_dev）
bash scripts/with-local-db-env.sh npx tsx scripts/import-subscription-lists.ts dump.ndjson

# 本番: トンネルを張って本番の接続情報で実行する（prod:tunnel と同じ接続経路）
npm run tunnel:start
op run --env-file=.env.1password.prod.tpl -- bash scripts/construct-database-url.sh \
  npx tsx scripts/import-subscription-lists.ts dump.ndjson
```

検証（下記）と、対象ユーザーごとの件数・料金合計の表示までを行う。**表示された件数・合計が
subscription-lists の画面と合っているかをここで見る。**

**3. 取り込み**: 同じコマンドに `--apply` を付ける。全体が1トランザクションで、書き込み後に
件数と料金合計（通貨別）を数え直し、移行元と食い違えばロールバックして止まる。

### 取り込む前に止まるもの（すべてまとめて表示される）

- **料金が0件のサブスク**: `getCurrentPrice` が落ち、金額も更新日も出せなくなるため
- **同じ適用開始日の料金が2件**: `@@unique([subscriptionId, effectiveFrom])` に入らないため
- 金額・日付・支払日などがアプリの入力検証（`parsePriceInput` / `parseSubscriptionInput`）を満たさない
- 参照切れ（存在しない支払い方法・ラベル、別ユーザーのものを指している）
- **対応するユーザーが Asset Manager にいない、または別人の疑いがある**。`User.id` は両アプリで別物（同じ値を持つとは限らない）
  ため、対応付けは次の順で行う
  1. `supabaseUserId`（両アプリが同じ Supabase プロジェクトを共用しており、ログイン済みなら同じ値が入る）
  2. 移行元が未ログインで NULL のときだけ `email`
  3. 両方で見つかったのに別のユーザー、またはメールが一致しても別の Supabase ユーザーに紐づく場合は止める。
     メールが違うなら `--to-email <Asset Managerのメール>`（メールだけで探す。データを持つユーザーが1人のときだけ）
  - **先に Asset Manager へ一度ログインしておく**（ユーザー行はログイン時に作られる）
- **対象ユーザーがすでにサブスク系のデータを持っている**: 二重取り込みの防止。やり直すときは、
  取り込んだ行を消してから流す

### 実装上の注意

- **移行元のIDは `cuid`、Asset Manager は `Int`**。親子関係は移行元のIDで保持し、書き込み時に
  採番されたIDへ張り替える（`lib/subscription-migration.ts` の計画は移行元IDのまま持つ）。
  `createSubscription` は色・並び順・作成日時を保てず料金を1件しか取れないため通さず、`prisma` へ直接書く
- **書き出しをSQL＋JSONの2段にしたのは、依存を足さないためではなく**（`mysql2` は `dependencies` にあるが
  未使用）、本番の移行元DBへ接続する場所と取り込み先の本番DBへ接続する場所が別で、素の `mysql` CLI だけで
  書き出せて中身を目で確かめられるため
- **`scripts/**` は ESLint の対象外**（`eslint.config.mjs`）。検証・ID張り替え・集計は `lib/subscription-migration.ts`
  に寄せてあり、`scripts/import-subscription-lists.ts` は引数解釈とDB書き込みだけ。lint が守るのは `lib/` 側で、
  スクリプトは `npm run typecheck` とローカルDBでの実行で確かめる
- **移行元のスキーマは `origin/develop` で確かめる。** `subscription-lists` の作業コピーが遅れていると
  （#492 では107コミット遅れ）`User.supabaseUserId` の追加などを見落とす。対象4テーブルの定義は変わっていない
- **`export.sql` の動作確認はローカルの MySQL 8.0 でしか行っていない。** 本番の移行元は MariaDB
  （`JSON_OBJECT` は 10.2.3 以降で使える）。差が出るとすれば JSON の空白・非ASCIIのエスケープ・真偽値の
  表現だが、取り込み側はいずれも受け入れる作りで、dry-run の段階で読めなければ行番号つきで止まる
- **`export.sql` は `JSON_ARRAYAGG` を使わない。** `group_concat_max_len` で黙って切れるため、1行ずつ出す
- **暗黙の多対多 `_LabelToSubscription` の列は `A`（Label）と `B`（Subscription）。** モデル名の
  アルファベット順で決まる
- 金額の突き合わせは**最小単位（×100の整数）**で行う。`Float` の足し算は誤差が出るため

## 分かっていること・残っていること

- **データ移行は済んでいる**（Issue #492）。subscription-lists の停止・撤去は利用者の手作業で、手順は #543
  （停止 → 様子見 → vhost・証明書・DNS → 認証まわり → DB の順。DB は最後）。撤去が済むまで、2つのアプリが並走する
- 支払い方法は削除ではなく**無効化**が既定の運用。使用中のものは削除できず、無効にすると
  新規登録の選択肢から外れるだけで、既存のサブスクからは消えない
