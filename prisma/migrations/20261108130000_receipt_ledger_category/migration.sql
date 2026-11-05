-- Issue #843（その1）: レシートの商品を家計簿のカテゴリ（LedgerCategory・支出）で分類する。
-- Zaimのカテゴリ/内訳の列は残す（既存の行の記録。#794 で削除する）。分類履歴は新しい行をZaimのidなしで作れるよう null を許す。

-- AlterTable
ALTER TABLE `ReceiptItem` ADD COLUMN `ledgerCategoryId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `ReceiptItem_ledgerCategoryId_idx` ON `ReceiptItem`(`ledgerCategoryId`);

-- AlterTable
ALTER TABLE `ProductClassificationRule` ADD COLUMN `ledgerCategoryId` INTEGER NULL,
    MODIFY `zaimCategoryId` INTEGER NULL,
    MODIFY `zaimGenreId` INTEGER NULL;

-- 既存の行を、利用者の「Zaimの分類名 → 家計簿のカテゴリ」の対応（LedgerSourceCategoryMapping）で埋める。
-- 内訳まで一致する対応 → カテゴリだけの対応（externalGenre = ''）の順（lib/ledger-sources/mapping.ts の resolveCategoryMapping と同じ）。
-- 対応先が同じ利用者の支出のカテゴリのときだけ使う。対応がまだ無い利用者の行は null のまま残り、
-- カテゴリの取り込み（applyCategoryImport）のあとに同じ処理（lib/receipt-category-service.ts の backfillReceiptLedgerCategories）で埋まる。

-- ReceiptItem: 内訳まで一致
UPDATE `ReceiptItem` ri
    JOIN `ReceiptImport` r ON r.`id` = ri.`receiptId`
    JOIN `LedgerSourceCategoryMapping` m
        ON m.`userId` = r.`userId`
        AND m.`provider` = 'zaim'
        AND m.`externalCategory` = ri.`categoryName`
        AND m.`externalGenre` = ri.`genreName`
    JOIN `LedgerCategory` c ON c.`id` = m.`categoryId` AND c.`userId` = r.`userId` AND c.`kind` = 'EXPENSE'
SET ri.`ledgerCategoryId` = c.`id`
WHERE ri.`ledgerCategoryId` IS NULL
    AND ri.`categoryName` IS NOT NULL
    AND ri.`genreName` IS NOT NULL
    AND ri.`genreName` <> '';

-- ReceiptItem: カテゴリだけの対応
UPDATE `ReceiptItem` ri
    JOIN `ReceiptImport` r ON r.`id` = ri.`receiptId`
    JOIN `LedgerSourceCategoryMapping` m
        ON m.`userId` = r.`userId`
        AND m.`provider` = 'zaim'
        AND m.`externalCategory` = ri.`categoryName`
        AND m.`externalGenre` = ''
    JOIN `LedgerCategory` c ON c.`id` = m.`categoryId` AND c.`userId` = r.`userId` AND c.`kind` = 'EXPENSE'
SET ri.`ledgerCategoryId` = c.`id`
WHERE ri.`ledgerCategoryId` IS NULL
    AND ri.`categoryName` IS NOT NULL;

-- ProductClassificationRule: 内訳まで一致
UPDATE `ProductClassificationRule` pr
    JOIN `LedgerSourceCategoryMapping` m
        ON m.`userId` = pr.`userId`
        AND m.`provider` = 'zaim'
        AND m.`externalCategory` = pr.`categoryName`
        AND m.`externalGenre` = pr.`genreName`
    JOIN `LedgerCategory` c ON c.`id` = m.`categoryId` AND c.`userId` = pr.`userId` AND c.`kind` = 'EXPENSE'
SET pr.`ledgerCategoryId` = c.`id`
WHERE pr.`ledgerCategoryId` IS NULL
    AND pr.`genreName` <> '';

-- ProductClassificationRule: カテゴリだけの対応
UPDATE `ProductClassificationRule` pr
    JOIN `LedgerSourceCategoryMapping` m
        ON m.`userId` = pr.`userId`
        AND m.`provider` = 'zaim'
        AND m.`externalCategory` = pr.`categoryName`
        AND m.`externalGenre` = ''
    JOIN `LedgerCategory` c ON c.`id` = m.`categoryId` AND c.`userId` = pr.`userId` AND c.`kind` = 'EXPENSE'
SET pr.`ledgerCategoryId` = c.`id`
WHERE pr.`ledgerCategoryId` IS NULL
    AND pr.`categoryName` <> '';
