-- Issue #815: 家計簿の基本モデル（口座・カテゴリ・取引・品目）と、家計簿の月の区切りの設定。
-- AlterTable
ALTER TABLE `User` ADD COLUMN `ledgerPeriodMode` VARCHAR(8) NOT NULL DEFAULT 'payday';

-- CreateTable
CREATE TABLE `LedgerAccount` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` ENUM('BANK', 'CARD', 'CASH', 'EMONEY', 'SECURITIES', 'POINT', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `hasStatementFeed` BOOLEAN NOT NULL DEFAULT false,
    `openingBalance` INTEGER NOT NULL DEFAULT 0,
    `openingDate` VARCHAR(10) NULL,
    `assetCategoryId` INTEGER NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `hidden` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerAccount_userId_idx`(`userId`),
    UNIQUE INDEX `LedgerAccount_userId_name_key`(`userId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerCategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` ENUM('EXPENSE', 'INCOME') NOT NULL DEFAULT 'EXPENSE',
    `parentId` INTEGER NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `hidden` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerCategory_userId_idx`(`userId`),
    INDEX `LedgerCategory_parentId_idx`(`parentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `kind` ENUM('EXPENSE', 'INCOME', 'TRANSFER', 'ADJUSTMENT') NOT NULL,
    `status` ENUM('CONFIRMED', 'PENDING_STATEMENT') NOT NULL DEFAULT 'CONFIRMED',
    `date` VARCHAR(10) NOT NULL,
    `amount` INTEGER NOT NULL,
    `fromAccountId` INTEGER NULL,
    `toAccountId` INTEGER NULL,
    `place` VARCHAR(191) NULL,
    `memo` TEXT NULL,
    `excludeFromTotals` BOOLEAN NOT NULL DEFAULT false,
    `origin` ENUM('MANUAL', 'BALANCE_EDIT', 'SOURCE', 'CSV', 'RECEIPT') NOT NULL DEFAULT 'MANUAL',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerEntry_userId_date_idx`(`userId`, `date`),
    INDEX `LedgerEntry_fromAccountId_idx`(`fromAccountId`),
    INDEX `LedgerEntry_toAccountId_idx`(`toAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entryId` INTEGER NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `name` VARCHAR(191) NOT NULL DEFAULT '',
    `amount` INTEGER NOT NULL,
    `quantity` DOUBLE NOT NULL DEFAULT 1,
    `categoryId` INTEGER NULL,
    `sourceCategoryName` VARCHAR(191) NULL,
    `classifiedBy` ENUM('MANUAL', 'HISTORY', 'AI', 'SOURCE', 'RULE') NULL,

    INDEX `LedgerLine_entryId_idx`(`entryId`),
    INDEX `LedgerLine_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

