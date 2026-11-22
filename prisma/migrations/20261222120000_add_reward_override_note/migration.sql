-- Issue #1544: 手動で特典の対象外にした理由。一覧の「特典の対象外（理由）」に出す。
ALTER TABLE `LedgerEntry` ADD COLUMN `rewardOverrideNote` VARCHAR(100) NULL;
