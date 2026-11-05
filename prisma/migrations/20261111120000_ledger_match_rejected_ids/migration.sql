-- 照合待ちのカード明細で「違う」を押した反映待ちの取引（Issue #859）
ALTER TABLE `LedgerEntry` ADD COLUMN `matchRejectedIds` JSON NULL;
