-- Issue #944: 1つの支出を複数の口座に分けて払う。
-- 口座ごとの金額は取引にぶら下がる LedgerPayment に持つ（分けていない取引は行を持たない）。

-- CreateTable
CREATE TABLE `LedgerPayment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `entryId` INTEGER NOT NULL,
    `accountId` INTEGER NOT NULL,
    `amount` INTEGER NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerPayment_userId_idx`(`userId`),
    INDEX `LedgerPayment_entryId_idx`(`entryId`),
    INDEX `LedgerPayment_accountId_idx`(`accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
