-- Issue #835: 「特別な支出」の印（取引）と、「会社関係」の属性（カテゴリ）。
-- AlterTable
ALTER TABLE `LedgerEntry` ADD COLUMN `special` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `LedgerCategory` ADD COLUMN `workRelated` BOOLEAN NOT NULL DEFAULT false;
