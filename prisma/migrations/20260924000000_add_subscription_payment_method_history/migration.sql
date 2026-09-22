-- 支払い方法を、料金（`SubscriptionPrice`）と同じ「適用開始日を持つ履歴」として管理する（Issue #517）。

-- CreateTable
CREATE TABLE `SubscriptionPaymentMethodHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `subscriptionId` INTEGER NOT NULL,
    `paymentMethodId` INTEGER NOT NULL,
    `effectiveFrom` DATE NOT NULL,
    `memo` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SubscriptionPaymentMethodHistory_subscriptionId_effectiveFro_idx`(`subscriptionId`, `effectiveFrom`),
    UNIQUE INDEX `SubscriptionPaymentMethodHistory_subscriptionId_effectiveFro_key`(`subscriptionId`, `effectiveFrom`),
    INDEX `SubscriptionPaymentMethodHistory_paymentMethodId_idx`(`paymentMethodId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 既存の支払い方法を、契約開始日を適用開始日とする初回の履歴として移す。
INSERT INTO `SubscriptionPaymentMethodHistory` (`subscriptionId`, `paymentMethodId`, `effectiveFrom`, `createdAt`, `updatedAt`)
SELECT `id`, `paymentMethodId`, `startDate`, NOW(3), NOW(3)
FROM `Subscription`;

-- AlterTable
-- 支払い方法は上の履行テーブルへ移したため、契約本体からは列を削除する（料金と同じ形）。
DROP INDEX `Subscription_paymentMethodId_idx` ON `Subscription`;
ALTER TABLE `Subscription` DROP COLUMN `paymentMethodId`;
