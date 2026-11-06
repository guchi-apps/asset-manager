-- Issue #912: 確定済みのカード明細から、家計簿に未登録のレシート・メールを候補として付ける。
-- 人が「違う」を押したレシート・メール（ReceiptImport の id）を、取引の id（matchRejectedIds）とは別に持つ。

-- AlterTable
ALTER TABLE `LedgerEntry` ADD COLUMN `rejectedReceiptIds` JSON NULL;
