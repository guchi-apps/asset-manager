-- Issue #818: レシート・メールを家計簿の取引に付ける。照合待ち（MATCH_PENDING）の状態。
-- AlterTable
ALTER TABLE `ReceiptImport` ADD COLUMN `ledgerAccountId` INTEGER NULL,
    ADD COLUMN `ledgerEntryId` INTEGER NULL;

-- AlterTable
ALTER TABLE `LedgerEntry` MODIFY `status` ENUM('CONFIRMED', 'PENDING_STATEMENT', 'MATCH_PENDING') NOT NULL DEFAULT 'CONFIRMED';

-- CreateIndex
CREATE INDEX `ReceiptImport_ledgerEntryId_idx` ON `ReceiptImport`(`ledgerEntryId`);

