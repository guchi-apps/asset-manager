-- Issue #816: 取り込み元の口座名・カテゴリ名と家計簿の対応表。取引・品目に取り込み元の原文を残す列。
-- AlterTable
ALTER TABLE `LedgerEntry` ADD COLUMN `sourceFromName` VARCHAR(191) NULL,
    ADD COLUMN `sourceProvider` VARCHAR(32) NULL,
    ADD COLUMN `sourceToName` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `LedgerLine` ADD COLUMN `sourceGenreName` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `LedgerSourceAccountMapping` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `externalName` VARCHAR(191) NOT NULL,
    `target` VARCHAR(16) NOT NULL DEFAULT 'ACCOUNT',
    `accountId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerSourceAccountMapping_userId_idx`(`userId`),
    UNIQUE INDEX `LedgerSourceAccountMapping_userId_provider_externalName_key`(`userId`, `provider`, `externalName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LedgerSourceCategoryMapping` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `externalCategory` VARCHAR(191) NOT NULL,
    `externalGenre` VARCHAR(191) NOT NULL DEFAULT '',
    `categoryId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerSourceCategoryMapping_userId_idx`(`userId`),
    UNIQUE INDEX `LedgerSourceCategoryMapping_userId_provider_externalCategory_key`(`userId`, `provider`, `externalCategory`, `externalGenre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

