-- 口座の用途にクレジットカードを追加する（#1117）。既存の値と NULL を保ったまま列挙し直す
ALTER TABLE `LedgerAccount` MODIFY COLUMN `purpose` ENUM('INVESTMENT', 'SAVINGS', 'LIVING', 'EMERGENCY', 'LIABILITY', 'CREDIT_CARD') NULL;
