-- Issue #1560: カード会社のアプリ（Vpassなど）で見た特典の対象の利用額（日付＋金額）を記録する。
-- CreateTable
CREATE TABLE `LedgerRewardSnapshot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `accountId` INTEGER NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    `amount` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerRewardSnapshot_userId_accountId_idx`(`userId`, `accountId`),
    UNIQUE INDEX `LedgerRewardSnapshot_accountId_date_key`(`accountId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

