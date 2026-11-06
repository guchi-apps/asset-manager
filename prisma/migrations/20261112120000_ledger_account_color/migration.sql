-- Issue #863: 家計簿の明細一覧に出す口座の印の色（`#rrggbb`）。NULL は口座IDから自動で決める。

-- AlterTable
ALTER TABLE `LedgerAccount` ADD COLUMN `color` VARCHAR(7) NULL;
