-- AlterTable
ALTER TABLE `ReceiptItem` ADD COLUMN `detailMissing` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `sourceSnapshot` JSON NULL;
