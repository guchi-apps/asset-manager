-- Issue #1479: 「Zaimの確認」にスマートレシート・Amazonから自動で登録した取引（origin = RECEIPT）も出すようにした。
-- これまでに作られたレシート由来の取引は確認の対象ではなかったため、確認済みにしておく（過去分が未確認で大量に並ばないように）。
-- 以後は自動登録の経路だけが zaimReviewedAt を空けて作り、ほかは作成時に確認済みにする（lib/ledger-receipt-service.ts の createReceiptEntry）。
UPDATE `LedgerEntry` SET `zaimReviewedAt` = `createdAt` WHERE `origin` = 'RECEIPT' AND `zaimReviewedAt` IS NULL;
