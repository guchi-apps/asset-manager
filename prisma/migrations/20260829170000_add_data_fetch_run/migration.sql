-- CreateTable
CREATE TABLE `DataFetchRun` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `job` ENUM('ZAIM_VALUATION', 'INDEX_VALUE') NOT NULL,
    `status` ENUM('SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED') NOT NULL,
    `trigger` ENUM('SCHEDULED', 'DEPLOY', 'MANUAL') NOT NULL DEFAULT 'SCHEDULED',
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `targetDay` VARCHAR(10) NULL,
    `sourceLabel` VARCHAR(191) NULL,
    `message` TEXT NULL,
    `reflected` INTEGER NOT NULL DEFAULT 0,
    `skipped` INTEGER NOT NULL DEFAULT 0,
    `unmatched` INTEGER NOT NULL DEFAULT 0,
    `failed` INTEGER NOT NULL DEFAULT 0,

    INDEX `DataFetchRun_userId_startedAt_idx`(`userId`, `startedAt`),
    INDEX `DataFetchRun_userId_job_startedAt_idx`(`userId`, `job`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DataFetchItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `runId` INTEGER NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `outcome` ENUM('REFLECTED', 'SKIPPED', 'UNMATCHED', 'FAILED') NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NULL,
    `amount` DOUBLE NULL,
    `previousValue` DOUBLE NULL,
    `recordDay` VARCHAR(10) NULL,
    `reason` VARCHAR(32) NULL,
    `detail` TEXT NULL,

    INDEX `DataFetchItem_runId_idx`(`runId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

