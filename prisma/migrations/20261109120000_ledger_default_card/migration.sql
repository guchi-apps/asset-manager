-- Issue #843（その2）: メール・外部アプリの明細を家計簿へ登録する既定のカードを、利用者の設定として持つ。
-- 以前は環境変数 ZAIM_CARD_ACCOUNT_ID のZaim口座（ZaimAccount）の名前から家計簿の口座を引いていた。
-- 既存の利用者の値は、最初の取り込みのときに同じ引き方で一度だけ埋める（lib/payment-import.ts の resolveLedgerAccountId）。
-- LedgerAccount への外部キーは張らない（口座を消すときは lib/ledger-service.ts の deleteAccount が null に戻す）。

-- AlterTable
ALTER TABLE `User` ADD COLUMN `ledgerDefaultCardAccountId` INTEGER NULL;
