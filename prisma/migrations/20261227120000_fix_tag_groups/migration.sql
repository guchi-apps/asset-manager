-- 投資資産の分類を固定の4つ（資産クラス・投資口座・NISA・企業型DC）にする（#1617）。
-- relationMode = "prisma" のため外部キーは無く、削除は子の表から順に明示する。

-- AlterTable
ALTER TABLE `TagGroup` ADD COLUMN `key` VARCHAR(191) NULL;

-- 名前が一致する分類へ固定の識別子を振る。同じユーザーに同名が複数あれば order → id の先頭だけ。
-- 同じ表を参照しながら UPDATE できないため（MySQL 1093）、対象を一時表へ写してから振る。
CREATE TEMPORARY TABLE `_FixedTagGroupPick` (`id` INTEGER NOT NULL PRIMARY KEY, `key` VARCHAR(191) NOT NULL);

INSERT INTO `_FixedTagGroupPick` (`id`, `key`)
SELECT g.`id`,
    CASE g.`name`
        WHEN '資産クラス' THEN 'ASSET_CLASS'
        WHEN '投資口座' THEN 'ACCOUNT'
        WHEN 'NISA' THEN 'NISA'
        WHEN '企業型DC' THEN 'DC'
    END
FROM `TagGroup` g
WHERE g.`name` IN ('資産クラス', '投資口座', 'NISA', '企業型DC')
    AND NOT EXISTS (
        SELECT 1 FROM `TagGroup` h
        WHERE h.`userId` = g.`userId`
            AND h.`name` = g.`name`
            AND (h.`order` < g.`order` OR (h.`order` = g.`order` AND h.`id` < g.`id`))
    );

UPDATE `TagGroup` t JOIN `_FixedTagGroupPick` p ON p.`id` = t.`id` SET t.`key` = p.`key`;

DROP TEMPORARY TABLE `_FixedTagGroupPick`;

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
