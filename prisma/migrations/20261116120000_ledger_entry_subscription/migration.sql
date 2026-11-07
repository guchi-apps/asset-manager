-- Issue #946: 家計簿の取引にサブスクを紐付ける。
-- subscriptionId は Subscription.id（外部キーは張らない）。rejectedSubscriptionIds は候補で「違う」を押した Subscription.id の配列。

-- AlterTable
ALTER TABLE `LedgerEntry` ADD COLUMN `subscriptionId` INTEGER NULL,
    ADD COLUMN `rejectedSubscriptionIds` JSON NULL;

-- CreateIndex
CREATE INDEX `LedgerEntry_subscriptionId_idx` ON `LedgerEntry`(`subscriptionId`);
