-- カードの締め日・引き落とし日・引き落とし先の口座を持たせる（#1141）。
-- 自己参照は Prisma の制約で NO ACTION。口座を消す・結合する前にアプリが指定を外す。MySQL 8.0・MariaDB の両方で通る構文だけを使う
ALTER TABLE `LedgerAccount`
    ADD COLUMN `closingDay` INTEGER NULL,
    ADD COLUMN `paymentDay` INTEGER NULL,
    ADD COLUMN `paymentMonthOffset` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `withdrawalAccountId` INTEGER NULL;

CREATE INDEX `LedgerAccount_withdrawalAccountId_idx` ON `LedgerAccount`(`withdrawalAccountId`);

ALTER TABLE `LedgerAccount` ADD CONSTRAINT `LedgerAccount_withdrawalAccountId_fkey` FOREIGN KEY (`withdrawalAccountId`) REFERENCES `LedgerAccount`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
