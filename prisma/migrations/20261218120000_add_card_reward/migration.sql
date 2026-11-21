-- Issue #1532: カード特典（三井住友カードの「年間100万円で1万ポイント」など）の利用額を、カードの口座ごとに集計する。
-- 口座: 集計するか・年度の起点月・目標額。取引: 特典の集計に数えるかの手動の上書き（NULL=自動判定）。
ALTER TABLE `LedgerAccount`
  ADD COLUMN `rewardEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `rewardStartMonth` INTEGER NULL,
  ADD COLUMN `rewardTarget` INTEGER NOT NULL DEFAULT 1000000;

ALTER TABLE `LedgerEntry` ADD COLUMN `rewardOverride` BOOLEAN NULL;
