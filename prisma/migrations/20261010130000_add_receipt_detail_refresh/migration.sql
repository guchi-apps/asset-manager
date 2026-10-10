-- AlterTable
ALTER TABLE `ReceiptImport` ADD COLUMN `detailRefreshStatus` VARCHAR(16) NULL,
    ADD COLUMN `detailRefreshJobId` VARCHAR(64) NULL,
    ADD COLUMN `detailRefreshMoneyId` BIGINT NULL,
    ADD COLUMN `detailRefreshRequestedAt` DATETIME(3) NULL,
    ADD COLUMN `detailRefreshFetchedAt` DATETIME(3) NULL,
    ADD COLUMN `detailRefreshError` TEXT NULL,
    ADD COLUMN `detailRefreshRetryable` BOOLEAN NULL;
