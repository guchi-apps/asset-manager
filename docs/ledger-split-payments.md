# 家計簿の支払いを分ける（Issue #944）

1つの支出を、複数の口座に分けて払った形（カード＋ポイント、現金＋PayPayなど）で記録する。
取引は1件のままで、品目・カテゴリ・立て替え・収支の集計は今までどおり取引の金額で数える。
口座の残高と口座の履歴だけが、その口座で払った分で動く。

## 持ち方

| 項目 | 持ち方 |
|---|---|
| 口座ごとの金額 | `LedgerPayment`（取引・口座・金額・順番）。2行以上・各行1円以上・合計は取引の金額と一致 |
| 分けていない取引 | `LedgerPayment` を持たない。今までどおり `fromAccountId` だけで残高を動かす |
| `fromAccountId` | 代表の口座。反映待ちならカード明細を待っている口座、確定なら先頭の口座 |
| 残高 | `lib/ledger-balance.ts` の `balanceEffect` が、支払いがある取引は支払いの行ごとに口座を減らす（`paidByAccount`） |

純粋な関数は `lib/ledger-payments.ts` に置いた（検証・代表の口座・照合の金額・確定時の支払い）。

## 制約（第1段）

- 分けられるのは**プラス金額の支出**だけ。マイナス金額（#943）・収入・振替は分けない
- 「あとで決める（口座未定の反映待ち）」「後払い」とは併用しない（分けると後払いの相手は付けない）
- 反映待ちにできるのは、分けた口座のうち**明細が届く口座（`hasStatementFeed`）がちょうど1つ**のとき。カード2枚の両方を待つ形は扱わない
- 照合待ち（`MATCH_PENDING`）のカード明細は分けられない（先に照合を済ませる）

## カード明細との照合

カード明細とは、待っている口座の分の金額で突き合わせる（`statementMatchAmount`）。候補探し（`findPendingForStatement`・
`loadPendingEntries`・`loadMatchReviews`）は、読み出した反映待ちの `amount` をこの金額に置き換えてから既存の判定に渡す。

確定するときは、待っていた口座の分だけをカード明細の金額にし、取引の金額をほかの支払いとの合計に直す（`applyStatementToPayments`）。

- 照合待ちの解消（`resolveMatchPending`。反映待ちの取引が残る）: 反映待ちの支払いを直し、品目の差額は合計に対して足す
- 確定済みのカード明細へ付ける（`attachToStatement`。カード明細が残る）: 反映待ちの支払いをカード明細へ移し、カード明細の金額を合計にする。
  カード明細がすでに分けてあれば、そちらを残す

どちらも金額が取り込み元（カードの分）と違うので、手直し済みの項目（`editedFields`）に `amount`・`accounts` を足し、
次の取り込みで金額・口座を戻さない。取り込み元で金額が変わったときは確認に出る。確認で取り込み元の金額・口座を採ると、
分けた支払いは外れて取り込み元の1口座の支払いに戻る（`lib/ledger-sources/review-service.ts`）。

## 取引を消す・付け替える経路

`relationMode = "prisma"` なのでDBの外部キーでは消えない。**取引を消す経路を新しく足すときは、`LedgerAdvance` と並べて
`LedgerPayment` も消すこと。** 今ある経路:

- 消す: `deleteEntry`・`deleteAccount`・`deleteAllLedgerData`（`lib/ledger-service.ts`）、レシートを外したとき・口座未定の取り消し
  （`lib/ledger-receipt-service.ts`）、ルールの付け直し・振替への変更（`lib/ledger-rule-service.ts`）、CSVの取り消し・対応表の付け直し・
  見当たらない明細の削除（`lib/ledger-sources/`）
- 作り直す: `updateEntry` は支払いを消してから作り直す
- 付け替える: `resolveMatchPending`・`attachToStatement` は上のとおり、消える側の支払いを消し、残る側に作り直す

## 口座の削除

`LedgerPayment.accountId` は NoAction。口座を消すと、その口座で払った分を含む取引ごと消す（出金元・入金先の取引と同じ扱い）。
削除の対象（`deleteAccount` の `FOR UPDATE` と残件数の確認）は、生SQLの `EXISTS (SELECT 1 FROM LedgerPayment ...)` で拾う
（MariaDBでも通る構文）。削除の影響の件数・口座の取引数・残高調整も、支払いの口座を含めて数える。

## 書き込みロック

作成・更新は、出金元・入金先に加えて支払いの全口座に共有ロックを取る（`lockAccountsForWrite`。#917）。
