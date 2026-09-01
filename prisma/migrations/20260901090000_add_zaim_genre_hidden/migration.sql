-- Issue #322: 使わない内訳を隠せるようにする。
-- Zaim側の値ではないため、マスタ取得（syncZaimMasters）の upsert では更新しない。
-- AlterTable
ALTER TABLE `ZaimGenre` ADD COLUMN `hidden` BOOLEAN NOT NULL DEFAULT false;
