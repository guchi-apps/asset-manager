-- Issue #855: 家計簿の明細一覧に出す口座の短縮名（正式名とは別）。

-- AlterTable
ALTER TABLE `LedgerAccount` ADD COLUMN `shortName` VARCHAR(32) NULL;
