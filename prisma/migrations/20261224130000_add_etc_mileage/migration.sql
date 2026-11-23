-- ETCマイレージ: ETC利用照会の口座に、ポイント使用分（利用実績とカード振替の差）と還元残高を出す。
-- 口座: 出すか。還元の残高: ETCマイレージサービスで見た値（日付＋金額）。
ALTER TABLE `LedgerAccount` ADD COLUMN `mileageEnabled` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `LedgerMileageSnapshot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `accountId` INTEGER NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    `amount` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerMileageSnapshot_userId_accountId_idx`(`userId`, `accountId`),
    UNIQUE INDEX `LedgerMileageSnapshot_accountId_date_key`(`accountId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

