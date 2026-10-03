-- Issue #632: 対応不要と判断したカード連携明細を、Zaimを変更せず記録する。
CREATE TABLE `CardReconciliationDismissal` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `userId` VARCHAR(191) NOT NULL,
  `moneyId` BIGINT NOT NULL,
  `date` VARCHAR(10) NOT NULL,
  `amount` INTEGER NOT NULL,
  `account` VARCHAR(191) NOT NULL,
  `place` VARCHAR(191) NULL,
  `name` VARCHAR(191) NULL,
  `dismissedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `CardReconciliationDismissal_userId_moneyId_key` (`userId`, `moneyId`),
  INDEX `CardReconciliationDismissal_userId_dismissedAt_idx` (`userId`, `dismissedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
