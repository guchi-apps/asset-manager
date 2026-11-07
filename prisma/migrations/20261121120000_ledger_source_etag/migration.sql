-- AlterTable
ALTER TABLE `User` ADD COLUMN `ledgerSourceEtag` VARCHAR(255) NULL,
    ADD COLUMN `ledgerSourceEtagAt` DATETIME(3) NULL;
