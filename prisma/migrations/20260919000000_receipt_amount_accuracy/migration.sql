-- 読み取った金額の精度と、Zaimの金額へ合わせた記録を持たせる（Issue #483）。
-- 既存の明細はすべて「正確」（amountApproximate = false）・未調整のまま残す。

-- AlterTable
ALTER TABLE `ReceiptImport`
    ADD COLUMN `amountApproximate` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `amountNote` VARCHAR(191) NULL,
    ADD COLUMN `originalAmount` DECIMAL(18, 4) NULL,
    ADD COLUMN `originalCurrency` VARCHAR(3) NULL,
    ADD COLUMN `amountAdjustedFrom` INTEGER NULL,
    ADD COLUMN `amountAdjustedAt` DATETIME(3) NULL;
