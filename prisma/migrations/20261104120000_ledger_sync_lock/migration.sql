-- Issue #817: 家計簿の明細の取り込みを利用者ごとに1つだけ動かすための印。
-- AlterTable
ALTER TABLE `User` ADD COLUMN `ledgerSyncLockedAt` DATETIME(3) NULL;

