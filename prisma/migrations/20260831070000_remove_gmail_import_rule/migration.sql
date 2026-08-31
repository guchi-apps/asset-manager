-- DropIndex
DROP INDEX `GmailImportedMessage_ruleId_idx` ON `GmailImportedMessage`;

-- AlterTable
ALTER TABLE `GmailImportedMessage` DROP COLUMN `ruleId`;

-- DropTable
DROP TABLE `GmailImportRule`;
