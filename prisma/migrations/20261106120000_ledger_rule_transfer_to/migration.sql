-- Issue #822: 分類ルールで支出を振替にするときの入金先の口座。
-- AlterTable
ALTER TABLE `LedgerClassificationRule` ADD COLUMN `accountId` INTEGER NULL;
