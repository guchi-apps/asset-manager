-- Issue #628: カード明細起点の照合・置き換え準備フロー
ALTER TABLE `User`
  ADD COLUMN `receiptCardFlowStartedAt` DATETIME(3) NULL;

ALTER TABLE `ReceiptImport`
  ADD COLUMN `matchedCardMoneyId` BIGINT NULL,
  ADD COLUMN `matchedCardDate` DATETIME(3) NULL,
  ADD COLUMN `matchedCardAmount` INTEGER NULL,
  ADD COLUMN `matchedCardAccountName` VARCHAR(191) NULL,
  ADD COLUMN `matchedAt` DATETIME(3) NULL,
  ADD COLUMN `sourceExcludedAt` DATETIME(3) NULL,
  ADD UNIQUE INDEX `ReceiptImport_userId_matchedCardMoneyId_key` (`userId`, `matchedCardMoneyId`);

-- 既存のREPLACED行には置き換え元カードのmoney idが無い。初回アクセス時に
-- User.receiptCardFlowStartedAtを設定し、それ以前のカード明細を新しい未対応一覧から除外する。
