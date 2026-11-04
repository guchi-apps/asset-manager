-- Issue #834: 取引の分類ルール（お店・メモ・品目名 → カテゴリ / 振替の受け側）。
-- CreateTable
CREATE TABLE `LedgerClassificationRule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `field` VARCHAR(16) NOT NULL DEFAULT 'PLACE',
    `pattern` VARCHAR(191) NOT NULL,
    `target` VARCHAR(16) NOT NULL DEFAULT 'CATEGORY',
    `categoryId` INTEGER NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerClassificationRule_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
