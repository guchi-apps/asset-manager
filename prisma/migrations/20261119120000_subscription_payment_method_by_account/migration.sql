-- サブスクの支払い方法を「家計簿の口座」を主にする形へ寄せる（Issue #985）。
-- 口座に紐づいた支払い方法は、口座ごとに1行へ統合する（履歴は残す側の行へ付け替える）。
-- MySQL 8.0 と MariaDB の両方で通る構文だけを使う（CTE・ウィンドウ関数は使わない）。

-- 1) 同じ口座を指す支払い方法の履歴を、いちばん古い行（id最小）へ付け替える
UPDATE `SubscriptionPaymentMethodHistory` h
JOIN `SubscriptionPaymentMethod` m ON m.`id` = h.`paymentMethodId`
JOIN (
    SELECT `userId`, `ledgerAccountId`, MIN(`id`) AS `keepId`
    FROM `SubscriptionPaymentMethod`
    WHERE `ledgerAccountId` IS NOT NULL
    GROUP BY `userId`, `ledgerAccountId`
) k ON k.`userId` = m.`userId` AND k.`ledgerAccountId` = m.`ledgerAccountId`
SET h.`paymentMethodId` = k.`keepId`
WHERE m.`id` <> k.`keepId`;

-- 2) 付け替え済みの重複行を消す
DELETE m FROM `SubscriptionPaymentMethod` m
JOIN `SubscriptionPaymentMethod` k
  ON k.`userId` = m.`userId` AND k.`ledgerAccountId` = m.`ledgerAccountId` AND k.`id` < m.`id`
WHERE m.`ledgerAccountId` IS NOT NULL;

-- 3a) 予約形式 `acct:<口座id>` の名前を、その口座自身の行以外が持っていると、次の更新や移行後の行の自動作成が
--     (userId, name) の一意制約に当たる（デプロイが止まる／行が作られない。#1011）。該当する行は予約でない名前へ退避する。
UPDATE `SubscriptionPaymentMethod`
SET `name` = CONCAT('移行前:', `id`, ':', `name`)
WHERE `name` LIKE 'acct:%'
  AND (`ledgerAccountId` IS NULL OR `name` <> CONCAT('acct:', `ledgerAccountId`));

-- 3) 口座に紐づく行の名前は口座から引くため、保存名は口座名と切り離した内部キーにする
UPDATE `SubscriptionPaymentMethod`
SET `name` = CONCAT('acct:', `ledgerAccountId`), `noZaimAccount` = false
WHERE `ledgerAccountId` IS NOT NULL;

-- 4) 口座ごとに1行（NULLは重複してよい）
CREATE UNIQUE INDEX `SubscriptionPaymentMethod_userId_ledgerAccountId_key`
ON `SubscriptionPaymentMethod`(`userId`, `ledgerAccountId`);
