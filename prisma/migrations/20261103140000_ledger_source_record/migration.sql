-- Issue #817: 取り込み元（Zaim）の明細のスナップショット、取り込み開始日、手直しした項目の記録、取り込みジョブの種別。
-- AlterTable
ALTER TABLE `User` ADD COLUMN `ledgerSourceStartDate` VARCHAR(10) NULL;

-- AlterTable
ALTER TABLE `DataFetchRun` MODIFY `job` ENUM('ZAIM_VALUATION', 'INDEX_VALUE', 'RECURRING_DEPOSIT', 'LEDGER_TRANSACTIONS') NOT NULL;

-- AlterTable
ALTER TABLE `LedgerEntry` ADD COLUMN `editedFields` JSON NULL;

-- CreateTable
CREATE TABLE `LedgerSourceRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `externalId` VARCHAR(64) NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    `amount` INTEGER NOT NULL,
    `payload` JSON NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `itemsStatus` VARCHAR(16) NULL,
    `kindInferred` BOOLEAN NOT NULL DEFAULT false,
    `state` ENUM('ACTIVE', 'CHANGED', 'MISSING', 'DISMISSED') NOT NULL DEFAULT 'ACTIVE',
    `pendingFields` JSON NULL,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `missingSince` DATETIME(3) NULL,
    `entryId` INTEGER NULL,
    `ignoredAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerSourceRecord_userId_state_idx`(`userId`, `state`),
    INDEX `LedgerSourceRecord_userId_date_idx`(`userId`, `date`),
    INDEX `LedgerSourceRecord_entryId_idx`(`entryId`),
    UNIQUE INDEX `LedgerSourceRecord_userId_provider_externalId_key`(`userId`, `provider`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

