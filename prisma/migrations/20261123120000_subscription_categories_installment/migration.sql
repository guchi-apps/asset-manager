-- 区分に「通信・公共料金」「会費・年会費」を足し、分割払いの支払回数を持てるようにする（Issue #1126）。
-- 本番はMariaDBのため、ENUM列は MODIFY で定義を置き換える（既存の値と既定値は保つ）。
ALTER TABLE `Subscription` MODIFY COLUMN `category` ENUM('SUBSCRIPTION', 'INSURANCE', 'TAX', 'INSTALLMENT', 'OTHER_FIXED_COST', 'COMMUNICATION', 'MEMBERSHIP') NOT NULL DEFAULT 'SUBSCRIPTION';

-- 分割払いの支払回数。終了日は保存せず、開始日・料金履歴と合わせて導出する。
ALTER TABLE `Subscription` ADD COLUMN `installmentCount` INTEGER NULL;

-- 名前が完全に一致するものだけ移す（Issue #512 と同じ方針）。一致しなければ SUBSCRIPTION のまま残るので、画面の編集から区分を変える。
UPDATE `Subscription` SET `category` = 'COMMUNICATION' WHERE `name` = '楽天モバイル' AND `category` = 'SUBSCRIPTION';
UPDATE `Subscription` SET `category` = 'MEMBERSHIP' WHERE `name` = 'JAF' AND `category` = 'SUBSCRIPTION';
