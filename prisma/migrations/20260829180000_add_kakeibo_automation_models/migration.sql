-- AlterTable
ALTER TABLE `ReceiptImport` MODIFY `source` ENUM('PHOTO', 'SMART_RECEIPT', 'AMAZON', 'GMAIL') NOT NULL DEFAULT 'PHOTO';

-- CreateTable
CREATE TABLE `ZaimGenreSuggestion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `zaimMoneyId` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `amount` INTEGER NOT NULL,
    `name` VARCHAR(191) NULL,
    `place` VARCHAR(191) NULL,
    `fromAccountId` INTEGER NULL,
    `accountName` VARCHAR(191) NULL,
    `zaimCategoryId` INTEGER NULL,
    `zaimGenreId` INTEGER NULL,
    `categoryName` VARCHAR(191) NULL,
    `genreName` VARCHAR(191) NULL,
    `confidence` DOUBLE NOT NULL DEFAULT 0,
    `source` ENUM('AI', 'HISTORY', 'MANUAL') NOT NULL DEFAULT 'AI',
    `reason` VARCHAR(191) NOT NULL DEFAULT '',
    `status` ENUM('PENDING', 'APPLIED', 'DISMISSED') NOT NULL DEFAULT 'PENDING',
    `appliedAt` DATETIME(3) NULL,
    `detectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ZaimGenreSuggestion_userId_idx`(`userId`),
    INDEX `ZaimGenreSuggestion_userId_status_idx`(`userId`, `status`),
    UNIQUE INDEX `ZaimGenreSuggestion_userId_zaimMoneyId_key`(`userId`, `zaimMoneyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ZaimCopyRule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `fromAccountId` INTEGER NOT NULL,
    `toAccountId` INTEGER NOT NULL,
    `fromAccountName` VARCHAR(191) NOT NULL,
    `toAccountName` VARCHAR(191) NOT NULL,
    `lookbackDays` INTEGER NOT NULL DEFAULT 60,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `autoCopy` BOOLEAN NOT NULL DEFAULT false,
    `lastRunAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ZaimCopyRule_userId_idx`(`userId`),
    UNIQUE INDEX `ZaimCopyRule_userId_fromAccountId_toAccountId_key`(`userId`, `fromAccountId`, `toAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ZaimCopiedEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `ruleId` INTEGER NOT NULL,
    `sourceMoneyId` INTEGER NOT NULL,
    `copiedMoneyId` INTEGER NOT NULL,
    `amount` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `copiedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ZaimCopiedEntry_ruleId_idx`(`ruleId`),
    INDEX `ZaimCopiedEntry_userId_idx`(`userId`),
    UNIQUE INDEX `ZaimCopiedEntry_userId_ruleId_sourceMoneyId_key`(`userId`, `ruleId`, `sourceMoneyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GmailImportRule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `fromQuery` VARCHAR(191) NOT NULL DEFAULT '',
    `subjectQuery` VARCHAR(191) NOT NULL DEFAULT '',
    `extraQuery` VARCHAR(191) NOT NULL DEFAULT '',
    `lookbackDays` INTEGER NOT NULL DEFAULT 30,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `lastRunAt` DATETIME(3) NULL,
    `importedCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `GmailImportRule_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GmailImportedMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `ruleId` INTEGER NULL,
    `gmailMessageId` VARCHAR(191) NOT NULL,
    `receiptId` INTEGER NULL,
    `subject` TEXT NULL,
    `skipReason` VARCHAR(191) NULL,
    `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GmailImportedMessage_userId_idx`(`userId`),
    INDEX `GmailImportedMessage_ruleId_idx`(`ruleId`),
    UNIQUE INDEX `GmailImportedMessage_userId_gmailMessageId_key`(`userId`, `gmailMessageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

