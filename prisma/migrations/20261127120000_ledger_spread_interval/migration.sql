-- 按分の間隔（月）を取引に持たせる（#1267）。MySQL 8.0・MariaDB の両方で通る構文だけを使う
ALTER TABLE `LedgerEntry`
    ADD COLUMN `spreadInterval` INTEGER NULL;
