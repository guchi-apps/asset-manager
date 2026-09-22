-- サブスクの支払い方法に、最終的に引き落とされるZaim口座を紐づける（Issue #566）。
-- 既存の支払い方法はすべて「未設定」（zaimAccountId = NULL・noZaimAccount = false）から始まる。

-- AlterTable
ALTER TABLE `SubscriptionPaymentMethod` ADD COLUMN `zaimAccountId` INTEGER NULL,
    ADD COLUMN `noZaimAccount` BOOLEAN NOT NULL DEFAULT false;
