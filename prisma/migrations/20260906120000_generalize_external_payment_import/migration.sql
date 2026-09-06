-- RenameTable
RENAME TABLE `GmailImportedMessage` TO `ExternalPaymentImport`;

-- AlterTable: gmailMessageId を externalId へ一般化し、source 列を追加する。
-- `NOT NULL DEFAULT 'gmail'` は既存行にも適用されるため、この1文で全既存行の
-- source が 'gmail'（validatePaymentImportInput が保存する文字列と同じ）になる。
-- これを埋め忘れると、既存のGmail取り込み済みメッセージが次の一意キー変更後に
-- 重複判定されなくなり、AIDE/ChatGPTが同じメールを送り直した際に二重登録される。
ALTER TABLE `ExternalPaymentImport`
    ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT 'gmail',
    CHANGE COLUMN `gmailMessageId` `externalId` VARCHAR(191) NOT NULL;

-- schema.prisma に @default を持たせていないため、以後のINSERTでは source を必須にする
ALTER TABLE `ExternalPaymentImport` ALTER COLUMN `source` DROP DEFAULT;

-- RenameIndex
ALTER TABLE `ExternalPaymentImport` RENAME INDEX `GmailImportedMessage_userId_idx` TO `ExternalPaymentImport_userId_idx`;

-- RenameUniqueIndex: userId + gmailMessageId から userId + source + externalId へ一般化
DROP INDEX `GmailImportedMessage_userId_gmailMessageId_key` ON `ExternalPaymentImport`;
CREATE UNIQUE INDEX `ExternalPaymentImport_userId_source_externalId_key` ON `ExternalPaymentImport`(`userId`, `source`, `externalId`);

-- AlterTable: ReceiptImport.source に Gmail 以外の外部アプリ向けの値を追加する
ALTER TABLE `ReceiptImport` MODIFY `source` ENUM('PHOTO', 'SMART_RECEIPT', 'AMAZON', 'GMAIL', 'EXTERNAL_APP') NOT NULL DEFAULT 'PHOTO';
