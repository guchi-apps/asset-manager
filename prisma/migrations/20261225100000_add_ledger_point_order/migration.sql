-- 口座タブの「ポイント」区画の並び順（Issue #1579）。Zaim由来のポイントと口座のポイントを1つの並びで持つ。
-- CreateTable
CREATE TABLE `LedgerPointOrder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `itemKey` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,

    UNIQUE INDEX `LedgerPointOrder_userId_itemKey_key`(`userId`, `itemKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

