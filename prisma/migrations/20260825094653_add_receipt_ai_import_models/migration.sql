-- CreateTable
CREATE TABLE `ReceiptImport` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `source` ENUM('PHOTO', 'SMART_RECEIPT', 'AMAZON') NOT NULL DEFAULT 'PHOTO',
    `status` ENUM('ANALYZING', 'REVIEW_REQUIRED', 'CONFIRMED', 'SENT_TO_ZAIM', 'FAILED') NOT NULL DEFAULT 'ANALYZING',
    `imagePath` VARCHAR(191) NULL,
    `imageMimeType` VARCHAR(191) NULL,
    `imageHash` VARCHAR(64) NULL,
    `storeName` VARCHAR(191) NULL,
    `purchasedAt` DATETIME(3) NULL,
    `sourceKey` VARCHAR(191) NULL,
    `sourceAccountId` INTEGER NULL,
    `totalAmount` INTEGER NULL,
    `taxAmount` INTEGER NULL,
    `discountAmount` INTEGER NULL,
    `confidence` DOUBLE NULL,
    `analysisError` TEXT NULL,
    `memo` TEXT NULL,
    `zaimMoneyId` INTEGER NULL,
    `zaimAccountId` INTEGER NULL,
    `sentToZaimAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReceiptImport_userId_idx`(`userId`),
    INDEX `ReceiptImport_userId_status_idx`(`userId`, `status`),
    INDEX `ReceiptImport_userId_imageHash_idx`(`userId`, `imageHash`),
    UNIQUE INDEX `ReceiptImport_userId_sourceKey_key`(`userId`, `sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReceiptItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `receiptId` INTEGER NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `rawName` VARCHAR(191) NOT NULL,
    `normalizedName` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL DEFAULT 1,
    `unitPrice` INTEGER NULL,
    `amount` INTEGER NOT NULL,
    `discount` INTEGER NOT NULL DEFAULT 0,
    `zaimCategoryId` INTEGER NULL,
    `zaimGenreId` INTEGER NULL,
    `categoryName` VARCHAR(191) NULL,
    `genreName` VARCHAR(191) NULL,
    `confidence` DOUBLE NULL,
    `classifiedBy` ENUM('AI', 'HISTORY', 'MANUAL') NOT NULL DEFAULT 'AI',
    `zaimMoneyId` INTEGER NULL,
    `sourceZaimMoneyId` INTEGER NULL,

    INDEX `ReceiptItem_receiptId_idx`(`receiptId`),
    INDEX `ReceiptItem_sourceZaimMoneyId_idx`(`sourceZaimMoneyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductClassificationRule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `normalizedName` VARCHAR(191) NOT NULL,
    `storeName` VARCHAR(191) NOT NULL DEFAULT '',
    `zaimCategoryId` INTEGER NOT NULL,
    `zaimGenreId` INTEGER NOT NULL,
    `categoryName` VARCHAR(191) NOT NULL,
    `genreName` VARCHAR(191) NOT NULL,
    `correctionCount` INTEGER NOT NULL DEFAULT 1,
    `lastUsedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProductClassificationRule_userId_idx`(`userId`),
    INDEX `ProductClassificationRule_userId_normalizedName_idx`(`userId`, `normalizedName`),
    UNIQUE INDEX `ProductClassificationRule_userId_normalizedName_storeName_key`(`userId`, `normalizedName`, `storeName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ZaimGenre` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `zaimGenreId` INTEGER NOT NULL,
    `zaimCategoryId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `categoryName` VARCHAR(191) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ZaimGenre_userId_idx`(`userId`),
    UNIQUE INDEX `ZaimGenre_userId_zaimGenreId_key`(`userId`, `zaimGenreId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ZaimAccount` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `zaimAccountId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ZaimAccount_userId_idx`(`userId`),
    UNIQUE INDEX `ZaimAccount_userId_zaimAccountId_key`(`userId`, `zaimAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReceiptMatchCandidate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `receiptId` INTEGER NOT NULL,
    `zaimMoneyId` INTEGER NOT NULL,
    `amount` INTEGER NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `accountName` VARCHAR(191) NULL,
    `placeName` VARCHAR(191) NULL,
    `score` DOUBLE NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `dismissed` BOOLEAN NOT NULL DEFAULT false,
    `detectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReceiptMatchCandidate_receiptId_idx`(`receiptId`),
    UNIQUE INDEX `ReceiptMatchCandidate_receiptId_zaimMoneyId_key`(`receiptId`, `zaimMoneyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

