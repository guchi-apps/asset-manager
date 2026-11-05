-- Issue #841: 家計簿の品目をAI（Jev）で分類した記録と、確定しなかったときの候補。
-- AlterTable
ALTER TABLE `LedgerLine` ADD COLUMN `aiCheckedAt` DATETIME(3) NULL,
    ADD COLUMN `suggestedCategoryId` INTEGER NULL;
