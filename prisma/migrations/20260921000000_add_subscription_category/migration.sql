-- AlterTable
-- 既存の契約は DEFAULT により SUBSCRIPTION になる。
ALTER TABLE `Subscription` ADD COLUMN `category` ENUM('SUBSCRIPTION', 'INSURANCE', 'TAX', 'INSTALLMENT', 'OTHER_FIXED_COST') NOT NULL DEFAULT 'SUBSCRIPTION';

-- サブスクから分けたい既存の契約を、名前が完全に一致するものだけ移行する（Issue #512）。
-- 表記が違って一致しなかったものは SUBSCRIPTION のまま残るので、画面の編集から区分を変える。
UPDATE `Subscription` SET `category` = 'INSTALLMENT' WHERE `name` = 'iPhone15';
UPDATE `Subscription` SET `category` = 'TAX' WHERE `name` = '自動車税';
UPDATE `Subscription` SET `category` = 'INSURANCE' WHERE `name` IN ('グループ生命共済', 'スマホ保険', '火災保険', '日常生活賠償安心');
