-- Issue #843: メール・外部アプリの明細の「既定のカード」をやめた（#859 の口座未定の反映待ちで受けるため）。
-- 直前の 20261109120000_ledger_default_card で足した列を消す（本番へ出る前に方針が変わったため、足して消す形にする）。
-- AlterTable
ALTER TABLE `User` DROP COLUMN `ledgerDefaultCardAccountId`;
