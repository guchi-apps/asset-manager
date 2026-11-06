-- Issue #878: サブスクの支払い方法の引き落とし先を、Zaimの口座（ZaimAccount）から家計簿の口座（LedgerAccount）へ移す。
-- zaimAccountId は移行元として残す（アプリは読まない）。noZaimAccount の意味は「口座なし」のまま使う。

-- AlterTable
ALTER TABLE `SubscriptionPaymentMethod` ADD COLUMN `ledgerAccountId` INTEGER NULL;

-- 1) ZaimAccount.name → 口座名の対応（LedgerSourceAccountMapping, provider='zaim', target='ACCOUNT'）→ 家計簿の口座
UPDATE `SubscriptionPaymentMethod` m
JOIN `ZaimAccount` z ON z.`userId` = m.`userId` AND z.`zaimAccountId` = m.`zaimAccountId`
JOIN `LedgerSourceAccountMapping` sm ON sm.`userId` = m.`userId`
    AND sm.`provider` = 'zaim' AND sm.`externalName` = z.`name` AND sm.`target` = 'ACCOUNT'
JOIN `LedgerAccount` la ON la.`userId` = m.`userId` AND la.`id` = sm.`accountId`
SET m.`ledgerAccountId` = la.`id`
WHERE m.`zaimAccountId` IS NOT NULL AND m.`ledgerAccountId` IS NULL;

-- 2) 対応が無いものは、同じ名前の家計簿の口座へ
UPDATE `SubscriptionPaymentMethod` m
JOIN `ZaimAccount` z ON z.`userId` = m.`userId` AND z.`zaimAccountId` = m.`zaimAccountId`
JOIN `LedgerAccount` la ON la.`userId` = m.`userId` AND la.`name` = z.`name`
SET m.`ledgerAccountId` = la.`id`
WHERE m.`zaimAccountId` IS NOT NULL AND m.`ledgerAccountId` IS NULL;

-- 移せなかった行（ZaimAccountに無い・対応する家計簿の口座が無い）は、画面で選び直してもらう。
-- そのとき「未設定」として扱われるよう、zaimAccountId だけが残った状態になる。
