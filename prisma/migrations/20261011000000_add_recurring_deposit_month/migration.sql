-- CreateTable
CREATE TABLE `RecurringDepositMonth` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `ruleId` INTEGER NULL,
    `month` VARCHAR(7) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `expectedDay` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `method` VARCHAR(16) NULL,
    `detectedDay` VARCHAR(10) NULL,
    `transactionId` INTEGER NULL,
    `reason` VARCHAR(64) NULL,
    `detail` TEXT NULL,
    `decidedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RecurringDepositMonth_userId_month_idx`(`userId`, `month`),
    UNIQUE INDEX `RecurringDepositMonth_userId_categoryId_month_key`(`userId`, `categoryId`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RecurringDepositMonth` ADD CONSTRAINT `RecurringDepositMonth_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 既存の最新1か月ぶんの判定結果を履歴へ移す。登録方法は記録が無いので method は NULL（登録方法不明）のまま、
-- 設定の現在値を写す（当時の値は分からないため、推測で別の値にはしない）。
INSERT INTO `RecurringDepositMonth`
    (`userId`, `categoryId`, `ruleId`, `month`, `amount`, `expectedDay`, `status`, `method`, `detectedDay`, `transactionId`, `decidedAt`, `updatedAt`)
SELECT
    `userId`, `categoryId`, `id`, `lastProcessedMonth`, `amount`, `expectedDay`,
    CASE WHEN `lastTransactionId` IS NOT NULL THEN 'REGISTERED' ELSE 'UNDETECTED' END,
    NULL, `lastDetectedDay`, `lastTransactionId`, `updatedAt`, `updatedAt`
FROM `RecurringDeposit`
WHERE `lastProcessedMonth` IS NOT NULL
  -- 設定を作る前に閉じた窓の見送りは、判定した結果ではないので移さない（未検出と断定しない）。
  AND (
    `lastTransactionId` IS NOT NULL
    OR DATE_ADD(
         DATE_ADD(STR_TO_DATE(CONCAT(`lastProcessedMonth`, '-01'), '%Y-%m-%d'),
                  INTERVAL (LEAST(`expectedDay`, DAY(LAST_DAY(STR_TO_DATE(CONCAT(`lastProcessedMonth`, '-01'), '%Y-%m-%d')))) - 1) DAY),
         INTERVAL 7 DAY
       ) >= DATE(CONVERT_TZ(`createdAt`, '+00:00', '+09:00'))
  );
