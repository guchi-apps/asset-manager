-- 定期払いに、紐づけた明細の品目へ付ける既定の家計簿カテゴリを持たせる（Issue #1288）
ALTER TABLE `Subscription` ADD COLUMN `ledgerCategoryId` INTEGER NULL;
