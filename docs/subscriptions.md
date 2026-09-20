# サブスク管理

サブスク管理アプリ（`guchi-apps/subscription-lists`）から、サブスク一覧・金額・更新日の機能を
移管したもの（Issue #491）。画面は `/subscriptions`、AIDE向けの読み出しは
`GET /api/subscriptions`。

**移していない機能**: 支払予定日のカレンダー、契約のタイムライン、クレジットカード台帳、
年間利用額ボーナスの進捗。Issue #491 で「不要」とされたため、モデルごと持ち込んでいない。

## データの持ち方

| モデル | 役割 |
|---|---|
| `Subscription` | 契約そのもの（名前・支払い方法・契約開始日／終了日・メモ） |
| `SubscriptionPrice` | 料金の変更履歴。「いつから いくら」を複数持つ |
| `SubscriptionPaymentMethod` | 支払い方法の選択肢 |
| `SubscriptionLabel` / `SubscriptionLabelLink` | ラベルの辞書と、サブスクとの対応 |

### 金額は「いま いくら」ではなく「いつから いくら」で持つ

`Subscription` に金額の列は無く、`SubscriptionPrice` を最低1件持つ。値上げは**上書きではなく
履歴の追加**で表す（編集ダイアログに金額欄が無いのはこのため。追加は詳細ダイアログから行う）。

表示に使う料金は `getCurrentPrice(prices, referenceDay)` が決める。`referenceDay` は通常は今日だが、
**解約済みのサブスクだけは契約終了日**を使う。今日で引くと、解約後に足した改定が過去の契約に
出てしまうため（`lib/subscription-service.ts` の `toView`）。

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

## 契約状況

`getContractStatus(endDate, autoRenew, today)` の3値。

| 値 | 条件 | 合計への算入 |
|---|---|---|
| `ENDED`（解約済み） | 終了日が今日より前 | 含めない |
| `SCHEDULED_TO_END`（解約予定） | 終了日が今日以降、または終了日が未定で `autoRenew = false` | **含める**（まだ払っている） |
| `AUTO_RENEWING`（自動更新中） | 終了日が未定で `autoRenew = true` | 含める |

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
- AIDE側のMCPツールはこのリポジトリの管理外。追加は別Issueで扱う

## 分かっていること・残っていること

- **subscription-lists の既存データは移していない。** 本番DBへ接続しない方針のため、移行手段は
  別Issueで扱う
- 支払い方法は削除ではなく**無効化**が既定の運用。使用中のものは削除できず、無効にすると
  新規登録の選択肢から外れるだけで、既存のサブスクからは消えない
