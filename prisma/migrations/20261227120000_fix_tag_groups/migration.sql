-- 投資資産の分類を固定の4つ（資産クラス・投資口座・NISA・企業型DC）にする（#1617）。
-- relationMode = "prisma" のため外部キーは無く、削除は子の表から順に明示する。

-- AlterTable
-- 本番のマイグレーション用ユーザーは CREATE TEMPORARY TABLES 権限を持たない（1044）ため、一時表は使わない。
-- 途中で失敗して再実行になっても重複カラムで落ちないよう、カラムが無いときだけ追加する
-- （ADD COLUMN IF NOT EXISTS は MySQL 8.0 に無いので、MariaDB・MySQL の両方で通る PREPARE で書く）。
SET @fixed_tag_group_ddl = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TagGroup' AND COLUMN_NAME = 'key') = 0,
    'ALTER TABLE `TagGroup` ADD COLUMN `key` VARCHAR(191) NULL',
    'SELECT 1'
);
PREPARE fixed_tag_group_stmt FROM @fixed_tag_group_ddl;
EXECUTE fixed_tag_group_stmt;
DEALLOCATE PREPARE fixed_tag_group_stmt;

-- 名前が一致する分類へ固定の識別子を振る。同じユーザーに同名が複数あれば order → id の先頭だけ。
-- UPDATE の対象表をサブクエリで参照できない（MySQL 1093）ため、同じ表を別名で結合して先頭かどうかを判定する。
UPDATE `TagGroup` t
LEFT JOIN `TagGroup` h
    ON h.`userId` = t.`userId`
    AND h.`name` = t.`name`
    AND (h.`order` < t.`order` OR (h.`order` = t.`order` AND h.`id` < t.`id`))
SET t.`key` = CASE t.`name`
    WHEN '資産クラス' THEN 'ASSET_CLASS'
    WHEN '投資口座' THEN 'ACCOUNT'
    WHEN 'NISA' THEN 'NISA'
    WHEN '企業型DC' THEN 'DC'
END
WHERE t.`name` IN ('資産クラス', '投資口座', 'NISA', '企業型DC')
    AND h.`id` IS NULL;

-- 固定から外れる分類（合計・通貨・NISA枠など）を、リバランス目標・割り当て・選択肢ごと消す。
-- 未分類を外す行（tagOptionId が NULL）も残さないよう、目標は tagGroupId で消す。
DELETE FROM `AllocationTarget`
WHERE `tagGroupId` IS NOT NULL
    AND `tagGroupId` NOT IN (SELECT `id` FROM `TagGroup` WHERE `key` IS NOT NULL);

DELETE FROM `CategoryTag` WHERE `tagGroupId` IN (SELECT `id` FROM `TagGroup` WHERE `key` IS NULL);
DELETE FROM `TagOption` WHERE `tagGroupId` IN (SELECT `id` FROM `TagGroup` WHERE `key` IS NULL);
DELETE FROM `TagGroup` WHERE `key` IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX `TagGroup_userId_key_key` ON `TagGroup`(`userId`, `key`);

-- 生活防衛費の指定は画面から無くしたので外す（負債の isLiability は評価額がマイナスのため触らない）
UPDATE `Category` SET `excludeFromInvestmentView` = false WHERE `excludeFromInvestmentView` = true;
