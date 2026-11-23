-- クレジットカード（#1586）。番号は上4桁（任意）と下4桁だけ持つ。全桁・セキュリティコードは持たない。
-- relationMode = "prisma" のため外部キーは張らない（口座の削除・結合は lib/ledger-service.ts が付け替える）。
-- CreateTable
CREATE TABLE `CreditCard` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `numberHead4` VARCHAR(4) NULL,
    `numberTail4` VARCHAR(4) NOT NULL,
    `expiryMonth` INTEGER NULL,
    `expiryYear` INTEGER NULL,
    `rewardRateBp` INTEGER NULL,
    `accountId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CreditCard_userId_idx`(`userId`),
    INDEX `CreditCard_accountId_idx`(`accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
