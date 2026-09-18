-- Zaim口座に種別（カード・銀行・手入力など）を持たせる（Issue #471）。
-- 既存の口座は種別が分からない（NULL）まま残す。NULL はカード扱いで、これまでと同じ動きになる。
-- 種別は次にマスタを取り込んだときに推定され、設定タブから選び直せる。

-- AlterTable
ALTER TABLE `ZaimAccount`
    ADD COLUMN `kind` ENUM('CARD', 'BANK', 'MANUAL', 'PENDING', 'OTHER') NULL,
    ADD COLUMN `kindManual` BOOLEAN NOT NULL DEFAULT false;
