-- CreateTable
CREATE TABLE `LedgerCardWithdrawalConfirmation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `cardId` INTEGER NOT NULL,
    `paymentDate` VARCHAR(10) NOT NULL,
    `amount` INTEGER NOT NULL,
    `sourceKey` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `LedgerCardWithdrawalConfirmation_userId_paymentDate_idx`(`userId`, `paymentDate`),
    UNIQUE INDEX `LedgerCardWithdrawalConfirmation_userId_sourceKey_key`(`userId`, `sourceKey`),
    UNIQUE INDEX `LedgerCardWithdrawalConfirmation_cardId_paymentDate_key`(`cardId`, `paymentDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
