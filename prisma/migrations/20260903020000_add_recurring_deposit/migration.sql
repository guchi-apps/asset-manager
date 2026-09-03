-- CreateTable
CREATE TABLE `RecurringDeposit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `amount` DOUBLE NOT NULL,
    `expectedDay` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `lastProcessedMonth` VARCHAR(7) NULL,
    `lastDetectedDay` VARCHAR(10) NULL,
    `lastTransactionId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RecurringDeposit_userId_idx`(`userId`),
    INDEX `RecurringDeposit_categoryId_idx`(`categoryId`),
    UNIQUE INDEX `RecurringDeposit_userId_categoryId_key`(`userId`, `categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `DataFetchRun` MODIFY `job` ENUM('ZAIM_VALUATION', 'INDEX_VALUE', 'RECURRING_DEPOSIT') NOT NULL;
