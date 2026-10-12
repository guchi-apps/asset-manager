-- CreateTable
CREATE TABLE `LegacyImportRecord` (
    `id` VARCHAR(191) NOT NULL,
    `source` VARCHAR(32) NOT NULL,
    `sourceModel` VARCHAR(64) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `sourceUserId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `contentHash` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LegacyImportRecord_userId_idx`(`userId`),
    UNIQUE INDEX `LegacyImportRecord_source_sourceModel_sourceId_key`(`source`, `sourceModel`, `sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

