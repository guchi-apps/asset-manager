-- 支払いで付いたポイント（#1583）。取引ごと・ポイント口座ごとに1行。
-- CreateTable
CREATE TABLE `LedgerPointEarning` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `entryId` INTEGER NOT NULL,
    `accountId` INTEGER NOT NULL,
    `points` INTEGER NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerPointEarning_userId_accountId_idx`(`userId`, `accountId`),
    UNIQUE INDEX `LedgerPointEarning_entryId_accountId_key`(`entryId`, `accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
