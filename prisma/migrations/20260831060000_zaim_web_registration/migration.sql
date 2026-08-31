-- Zaimへの登録をAPI先行登録からAIDE経由のWeb版登録へ切り替える（Issue #302）。

-- AlterTable
ALTER TABLE `ReceiptImport`
    MODIFY `status` ENUM('ANALYZING', 'REVIEW_REQUIRED', 'CONFIRMED', 'SENT_TO_ZAIM', 'REPLACED', 'MANUAL_ACTION_REQUIRED', 'FAILED') NOT NULL DEFAULT 'ANALYZING',
    ADD COLUMN `replacedAt` DATETIME(3) NULL,
    ADD COLUMN `zaimRegisterError` TEXT NULL;

-- AlterTable
ALTER TABLE `ReceiptItem`
    ADD COLUMN `zaimRegisteredAt` DATETIME(3) NULL;

-- 置き換え前のカード連携明細は公開APIから見えないため、APIの支出一覧から作っていた
-- 「置き換え候補」は成立しない（#300 の実測）。表そのものを落とす。
-- DropTable
DROP TABLE `ReceiptMatchCandidate`;
