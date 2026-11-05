-- Issue #848: AI（Jev）で判定した品目の確信度。確定・候補・該当なしのどれでも残す。
-- AlterTable
ALTER TABLE `LedgerLine` ADD COLUMN `aiConfidence` DOUBLE NULL;
