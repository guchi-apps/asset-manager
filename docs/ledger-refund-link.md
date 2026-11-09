# 返金と支払い明細の紐づけ（#1259）

返金の取引（マイナスの支出、または収入）が、どの支払い（支出の取引）への返金かを `LedgerEntry.refundOfEntryId` に持つ。
**印を付けるだけで、金額・残高・按分などの集計は変えない**（`subscriptionId` と同じ考え方）。

- 返金元を付けられるのは `isRefundAmount`（マイナスの支出・プラスの収入）、返金元にできるのは `isRefundTarget`（プラスの支出）。`lib/ledger-refund.ts`
- 1つの返金に付けられる返金元は1件。1つの支払いに返金は何件でも付けられ、一覧の「返金あり」と編集ダイアログの「返金後の実質負担」に出る
- 外部キーは張らない（relationMode = prisma）。**読み出し（`loadRefundLinks`）は、指す先が無い・支出でない行を無視する**ので、
  取引を消す経路で解除し忘れても画面は壊れない（id は再利用されない）
- 解除・付け替えを入れた経路: `deleteEntryInTx`・`deleteEntriesInTx`（`clearRefundLinks`）、カード明細の照合（`moveRefundLinks`。
  確定側が消えて反映待ち側が残るため、返金の紐づけを残る側へ移す）、反映待ち支出のカード明細への添付（`attachToStatement`。
  逆に反映待ち側が消えてカード明細が残るので、同じく残る側へ移す。#1274）。ほかの削除（取り込み・ルール・全消去など）は読み出し側の無視に任せている
- 候補は `loadRefundCandidates`。同じ店 → 返金額以上 → 日付が近い順（`rankRefundCandidates`）
