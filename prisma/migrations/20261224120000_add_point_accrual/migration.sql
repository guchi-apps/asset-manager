-- ポイント（PayPayポイントなど）の自動計算。ポイント口座に、貯まる元の口座・開始日・還元率・付与までの日数を持たせ、
-- 取引には還元率の上書きを持たせる。
ALTER TABLE `LedgerAccount`
    ADD COLUMN `pointSourceAccountId` INTEGER NULL,
    ADD COLUMN `pointStartDate` VARCHAR(10) NULL,
    ADD COLUMN `pointRateBp` INTEGER NOT NULL DEFAULT 50,
    ADD COLUMN `pointBaseLagDays` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `pointBonusLagDays` INTEGER NOT NULL DEFAULT 31;

ALTER TABLE `LedgerEntry` ADD COLUMN `pointRateBp` INTEGER NULL;
