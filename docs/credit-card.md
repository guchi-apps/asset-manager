# クレジットカードの登録（Issue #1586）

支払いに使うカードの情報を登録し、家計簿の口座と紐付ける。メインの入り口はサイドメニューの「クレジットカード」（`/credit-cards`）。

## 目的

レシートや買い物のメールには、カード番号の**下4桁**が載っていることが多い。「これは何の支払いだっけ」となったときに、
口座を選ぶ画面（取引の支払い口座・レシート確認）に出る下4桁から「このカードで払った」と確かめられるようにする。

## 持ち方（`CreditCard`）

- `name`（64字まで）・`numberHead4`（上4桁。任意）・`numberTail4`（下4桁。必須）・`expiryMonth`/`expiryYear`（2つそろうか、2つとも null）・`rewardRateBp`（基本還元率。50 = 0.5%）・`accountId`（紐付ける家計簿の口座。任意）
- 1つの口座に複数枚（本会員・家族カード）を紐付けられる
- **カード番号は全桁を保存しない。セキュリティコード・ポイント番号も持たない**（31.security・ユーザー指示）。
  `parseCreditCardInput`（`lib/credit-card.ts`）は4桁ちょうどの数字以外（全桁・ハイフン区切り・5桁以上）を弾く。画面の入力欄も4桁までしか入らない
- 口座との関係は `relationMode = "prisma"` のため外部キーを張っていない。口座の削除は紐付けだけ外し（`deleteAccount`）、結合は結合先へ付け替える（`mergeAccount`。`docs/ledger-account-merge.md`）

## 表示

- `/credit-cards`: 一覧・追加・編集・削除。有効期限が3か月以内なら「あとNか月で期限」、過ぎていれば「期限切れ」（期限の月の末日まで有効。`creditCardExpiry`）
- 口座の詳細画面: 紐付いたカードの情報（`components/credit-cards/linked-cards.tsx`）
- 口座を選ぶ画面: 口座名の下に「カード下4桁 1234・9876」（`components/ledger/account-picker-pane.tsx` の `creditCards`）。`LedgerAccountView.creditCards`（取引フォーム）と `loadReceiptLedgerAccounts`（レシート確認）が渡す
