-- Issue #774: カード明細の加盟店名と取り込み明細の店舗名の組が同じ店かを、AIの判定と人の判断から覚える。
CREATE TABLE `CardStorePairVerdict` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `userId` VARCHAR(191) NOT NULL,
  `cardStore` VARCHAR(191) NOT NULL,
  `receiptStore` VARCHAR(191) NOT NULL,
  `verdict` VARCHAR(16) NOT NULL,
  `source` VARCHAR(16) NOT NULL,
  `reason` VARCHAR(191) NULL,
  `cardLabel` VARCHAR(191) NULL,
  `receiptLabel` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `CardStorePairVerdict_userId_cardStore_receiptStore_key` (`userId`, `cardStore`, `receiptStore`),
  INDEX `CardStorePairVerdict_userId_source_updatedAt_idx` (`userId`, `source`, `updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
