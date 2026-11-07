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

-- 3a) 口座なし・未設定の行（や別の口座の行）が、予約形式 `acct:<口座id>` と同じ名前を持っていると、次の更新で
--     (userId, name) の一意制約に当たってデプロイが止まる（#1011）。衝突する行だけ、予約でない名前へ退避する。
UPDATE `SubscriptionPaymentMethod` o
JOIN `SubscriptionPaymentMethod` a
  ON a.`userId` = o.`userId` AND a.`ledgerAccountId` IS NOT NULL AND o.`name` = CONCAT('acct:', a.`ledgerAccountId`)
SET o.`name` = CONCAT('移行前:', o.`id`, ':', o.`name`)
WHERE o.`ledgerAccountId` IS NULL OR o.`ledgerAccountId` <> a.`ledgerAccountId`;

-- 3) 口座に紐づく行の名前は口座から引くため、保存名は口座名と切り離した内部キーにする
UPDATE `SubscriptionPaymentMethod`
SET `name` = CONCAT('acct:', `ledgerAccountId`), `noZaimAccount` = false
WHERE `ledgerAccountId` IS NOT NULL;

-- 4) 口座ごとに1行（NULLは重複してよい）
CREATE UNIQUE INDEX `SubscriptionPaymentMethod_userId_ledgerAccountId_key`
ON `SubscriptionPaymentMethod`(`userId`, `ledgerAccountId`);
