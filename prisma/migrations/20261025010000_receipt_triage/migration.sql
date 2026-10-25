-- Issue #768: 作業一覧で使わないことにした取り込み明細と、「詳細明細を探す」の最後の結果を記録する。
ALTER TABLE `ReceiptImport`
  ADD COLUMN `setAsideAt` DATETIME(3) NULL,
  ADD COLUMN `setAsideReason` VARCHAR(32) NULL,
  ADD COLUMN `setAsideForReceiptId` INTEGER NULL;

ALTER TABLE `User`
  ADD COLUMN `receiptDetailSearchedAt` DATETIME(3) NULL,
  ADD COLUMN `receiptDetailSearchError` TEXT NULL,
  ADD COLUMN `receiptDetailSearchWebReason` TEXT NULL;
