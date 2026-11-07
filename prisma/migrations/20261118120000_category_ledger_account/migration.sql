-- 資産カテゴリに、中身として結び付けた家計簿の口座を持たせる（Issue #970）。
-- 1つの口座（証券口座）に複数のカテゴリ（銘柄）がぶら下がるため、口座側の `assetCategoryId`（1つ）から付け替える。
ALTER TABLE `Category` ADD COLUMN `ledgerAccountId` INTEGER NULL;
CREATE INDEX `Category_ledgerAccountId_idx` ON `Category`(`ledgerAccountId`);

-- 既存の結び付けを写す。同じカテゴリを複数の口座が指していたときは、用途の判定と同じく
-- 表示中の口座 → order → id の先頭を採る（`lib/account-purpose.ts` の旧 `resolveCategoryPurposes`）。
UPDATE `Category` c
SET c.`ledgerAccountId` = (
    SELECT a.`id` FROM `LedgerAccount` a
    WHERE a.`assetCategoryId` = c.`id` AND a.`userId` = c.`userId`
    ORDER BY a.`hidden` ASC, a.`order` ASC, a.`id` ASC
    LIMIT 1
);

ALTER TABLE `LedgerAccount` DROP COLUMN `assetCategoryId`;
