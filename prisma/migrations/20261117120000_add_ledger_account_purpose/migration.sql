-- 口座の用途（Issue #965）。NULL 可なので既存の行はそのまま（従来どおり資産カテゴリの種別から判定）。
ALTER TABLE `LedgerAccount` ADD COLUMN `purpose` ENUM('INVESTMENT', 'SAVINGS', 'LIVING', 'EMERGENCY', 'LIABILITY') NULL;
