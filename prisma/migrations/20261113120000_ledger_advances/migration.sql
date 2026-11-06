-- Issue #880: 立て替え（貸し）と後払い（借り）。
-- 立て替えた金額は取引にぶら下がる LedgerAdvance に持ち、後払い・精算の相手は LedgerEntry.counterparty に持つ。
-- 回収・支払いは新しい種別 SETTLEMENT の取引として残す（収支には含めない）。

-- AlterTable
ALTER TABLE `LedgerEntry` MODIFY `kind` ENUM('EXPENSE', 'INCOME', 'TRANSFER', 'ADJUSTMENT', 'SETTLEMENT') NOT NULL,
    ADD COLUMN `counterparty` VARCHAR(64) NULL;

-- CreateTable
CREATE TABLE `LedgerAdvance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `entryId` INTEGER NOT NULL,
    `counterparty` VARCHAR(64) NOT NULL,
    `amount` INTEGER NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerAdvance_userId_idx`(`userId`),
    INDEX `LedgerAdvance_entryId_idx`(`entryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
