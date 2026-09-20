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

## subscription-lists からのデータ移行（Issue #492）

#491 では機能だけを移したので、既存のデータは**手で移行する**。本番DBへ接続するのは実装エージェントでは
なく利用者なので、手段（書き出しSQLと取り込みスクリプト）だけをここに用意している。

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

- **移行手段は用意したが、本番への実行は利用者の手作業。** 実行するまで `/subscriptions` は空のまま
  （Issue #492。実行後に subscription-lists の停止・撤去へ進む）
- 支払い方法は削除ではなく**無効化**が既定の運用。使用中のものは削除できず、無効にすると
  新規登録の選択肢から外れるだけで、既存のサブスクからは消えない
