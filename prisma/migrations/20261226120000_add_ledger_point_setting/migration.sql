-- 口座タブの「ポイント」区画の、Zaim由来のポイントごとの設定（#1603）。
-- relationMode = "prisma" のため外部キーは張らない。
-- CreateTable
CREATE TABLE `LedgerPointSetting` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `itemKey` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(32) NULL,
    `color` VARCHAR(7) NULL,
    `hidden` BOOLEAN NOT NULL DEFAULT false,
    `lastSeenAmount` INTEGER NULL,

    UNIQUE INDEX `LedgerPointSetting_userId_itemKey_key`(`userId`, `itemKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
