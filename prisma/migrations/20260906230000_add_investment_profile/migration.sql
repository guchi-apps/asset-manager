-- Issue #397: リバランスのAI助言で配分を提案するための投資プロフィールを User に持つ。
-- いずれも任意（NULL 可）。毎月の積立額は RecurringDeposit の合計を使うため列にしない。
-- AlterTable
ALTER TABLE `User` ADD COLUMN `birthYear` INTEGER NULL,
    ADD COLUMN `retirementAge` INTEGER NULL,
    ADD COLUMN `riskTolerance` VARCHAR(16) NULL,
    ADD COLUMN `investmentNote` TEXT NULL;
