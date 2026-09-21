-- CreateTable
CREATE TABLE `AiUsageLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `feature` VARCHAR(64) NOT NULL,
    `model` VARCHAR(128) NOT NULL,
    `inputTokens` INTEGER NOT NULL,
    `outputTokens` INTEGER NOT NULL,
    `cacheReadTokens` INTEGER NOT NULL DEFAULT 0,
    `cacheWriteTokens` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AiUsageLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

