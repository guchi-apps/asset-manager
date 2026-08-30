-- AlterTable
ALTER TABLE `GmailImportedMessage`
    ADD COLUMN `threadId` VARCHAR(191) NULL,
    ADD COLUMN `rawSender` VARCHAR(191) NULL,
    ADD COLUMN `sourceMetadata` JSON NULL;
