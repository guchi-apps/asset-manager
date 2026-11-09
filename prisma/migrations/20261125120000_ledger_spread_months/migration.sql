-- 複数月分の支出を月単位で按分する月数を取引に持たせる（#1252）。MySQL 8.0・MariaDB の両方で通る構文だけを使う
ALTER TABLE `LedgerEntry`
    ADD COLUMN `spreadMonths` INTEGER NULL;
