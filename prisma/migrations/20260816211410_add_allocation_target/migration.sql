-- CreateTable
CREATE TABLE `AllocationTarget` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `categoryId` INTEGER NULL,
    `tagGroupId` INTEGER NULL,
    `tagOptionId` INTEGER NULL,
    `ratio` DOUBLE NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AllocationTarget_userId_idx`(`userId`),
    INDEX `AllocationTarget_tagGroupId_idx`(`tagGroupId`),
    UNIQUE INDEX `AllocationTarget_userId_categoryId_key`(`userId`, `categoryId`),
    UNIQUE INDEX `AllocationTarget_userId_tagOptionId_key`(`userId`, `tagOptionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
