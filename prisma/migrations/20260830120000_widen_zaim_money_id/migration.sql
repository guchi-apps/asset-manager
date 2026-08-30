-- AlterTable
ALTER TABLE `ReceiptImport` MODIFY `zaimMoneyId` BIGINT NULL;

-- AlterTable
ALTER TABLE `ReceiptItem` MODIFY `zaimMoneyId` BIGINT NULL,
    MODIFY `sourceZaimMoneyId` BIGINT NULL;

-- AlterTable
ALTER TABLE `ReceiptMatchCandidate` MODIFY `zaimMoneyId` BIGINT NOT NULL;

-- AlterTable
ALTER TABLE `ZaimCopiedEntry` MODIFY `sourceMoneyId` BIGINT NOT NULL,
    MODIFY `copiedMoneyId` BIGINT NOT NULL;

-- AlterTable
ALTER TABLE `ZaimGenreSuggestion` MODIFY `zaimMoneyId` BIGINT NOT NULL;

