-- Issue #820: Zaim CSVからの移行。取り込み単位（取り消し用）と、行の重複防止キー。
-- AlterTable
ALTER TABLE `LedgerEntry` ADD COLUMN `importBatchId` INTEGER NULL,
    ADD COLUMN `importKey` VARCHAR(64) NULL;

-- CreateTable
CREATE TABLE `LedgerImportBatch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `format` VARCHAR(32) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `fileHash` VARCHAR(64) NOT NULL,
    `cutoffDate` VARCHAR(10) NOT NULL,
    `rowCount` INTEGER NOT NULL DEFAULT 0,
    `entryCount` INTEGER NOT NULL DEFAULT 0,
    `duplicateCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LedgerImportBatch_userId_idx`(`userId`),
    UNIQUE INDEX `LedgerImportBatch_userId_fileHash_key`(`userId`, `fileHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `LedgerEntry_importBatchId_idx` ON `LedgerEntry`(`importBatchId`);

-- CreateIndex
CREATE UNIQUE INDEX `LedgerEntry_userId_importKey_key` ON `LedgerEntry`(`userId`, `importKey`);

