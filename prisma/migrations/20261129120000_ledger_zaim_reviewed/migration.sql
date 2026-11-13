-- Zaimから取り込んだ取引の「確認済み」の印（Issue #1342）
ALTER TABLE `LedgerEntry` ADD COLUMN `zaimReviewedAt` DATETIME(3) NULL;

-- 既存の自動同期の取引は確認済みにして、過去分が未確認として並ばないようにする
UPDATE `LedgerEntry` SET `zaimReviewedAt` = `createdAt` WHERE `origin` = 'SOURCE' AND `sourceProvider` = 'zaim';

CREATE INDEX `LedgerEntry_userId_origin_zaimReviewedAt_idx` ON `LedgerEntry`(`userId`, `origin`, `zaimReviewedAt`);
