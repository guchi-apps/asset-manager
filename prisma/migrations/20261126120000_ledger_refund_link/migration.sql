-- 返金の取引が、どの支払いへの返金かを持たせる（#1259）。MySQL 8.0・MariaDB の両方で通る構文だけを使う
ALTER TABLE `LedgerEntry`
    ADD COLUMN `refundOfEntryId` INTEGER NULL;

CREATE INDEX `LedgerEntry_refundOfEntryId_idx` ON `LedgerEntry`(`refundOfEntryId`);
