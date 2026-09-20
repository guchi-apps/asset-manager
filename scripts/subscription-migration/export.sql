-- subscription-lists のサブスクデータを NDJSON（1行1レコード）で書き出す（Issue #492）。
--
-- 使い方（移行元の DB に接続して実行する。書き込みは一切しない）:
--
--   mysql --batch --raw --skip-column-names --default-character-set=utf8mb4 \
--     -u <ユーザー> -p <subscription-lists のDB名> < scripts/subscription-migration/export.sql > dump.ndjson
--
-- 出力は `scripts/import-subscription-lists.ts` が読む。詳細は docs/subscriptions.md。
--
-- - `--raw` が必須。無いと mysql クライアントが `\` をエスケープし、JSON が壊れる
-- - 集約（JSON_ARRAYAGG）は使わない。group_concat_max_len で黙って切れるため、1行ずつ出す
-- - 日付は `YYYY-MM-DD`、日時は UTC の ISO8601、`Decimal` は文字列（丸めを避ける）で出す
-- - 移さないもの: BonusPeriod / BonusSpendEntry / CreditCard（#491 で移管対象外）
--
-- ユーザーはサブスク系のデータを持つ人だけを出す。メールアドレスは移行先のユーザーとの対応付けに使う。

SELECT JSON_OBJECT('kind', 'user', 'id', u.id, 'email', u.email)
FROM `User` u
WHERE u.id IN (SELECT userId FROM `Subscription`)
   OR u.id IN (SELECT userId FROM `PaymentMethod`)
   OR u.id IN (SELECT userId FROM `Label`)
ORDER BY u.id;

SELECT JSON_OBJECT(
  'kind', 'paymentMethod', 'id', id, 'userId', userId, 'name', name,
  'displayOrder', displayOrder, 'isActive', isActive,
  'createdAt', DATE_FORMAT(createdAt, '%Y-%m-%dT%H:%i:%s.%fZ'),
  'updatedAt', DATE_FORMAT(updatedAt, '%Y-%m-%dT%H:%i:%s.%fZ')
)
FROM `PaymentMethod`
ORDER BY id;

SELECT JSON_OBJECT(
  'kind', 'label', 'id', id, 'userId', userId, 'name', name, 'color', color,
  'createdAt', DATE_FORMAT(createdAt, '%Y-%m-%dT%H:%i:%s.%fZ'),
  'updatedAt', DATE_FORMAT(updatedAt, '%Y-%m-%dT%H:%i:%s.%fZ')
)
FROM `Label`
ORDER BY id;

SELECT JSON_OBJECT(
  'kind', 'subscription', 'id', id, 'userId', userId, 'name', name,
  'paymentMethodId', paymentMethodId,
  'startDate', DATE_FORMAT(startDate, '%Y-%m-%d'),
  'endDate', DATE_FORMAT(endDate, '%Y-%m-%d'),
  'autoRenew', autoRenew, 'memo', memo,
  'createdAt', DATE_FORMAT(createdAt, '%Y-%m-%dT%H:%i:%s.%fZ'),
  'updatedAt', DATE_FORMAT(updatedAt, '%Y-%m-%dT%H:%i:%s.%fZ')
)
FROM `Subscription`
ORDER BY id;

SELECT JSON_OBJECT(
  'kind', 'price', 'id', id, 'subscriptionId', subscriptionId,
  'amount', CAST(amount AS CHAR), 'currency', currency,
  'billingCycle', billingCycle, 'billingInterval', billingInterval,
  'billingDay', billingDay, 'billingMonth', billingMonth,
  'effectiveFrom', DATE_FORMAT(effectiveFrom, '%Y-%m-%d'), 'memo', memo,
  'createdAt', DATE_FORMAT(createdAt, '%Y-%m-%dT%H:%i:%s.%fZ'),
  'updatedAt', DATE_FORMAT(updatedAt, '%Y-%m-%dT%H:%i:%s.%fZ')
)
FROM `SubscriptionPrice`
ORDER BY id;

-- Prisma の暗黙の多対多。列名は A / B で、モデル名のアルファベット順（A = Label, B = Subscription）
SELECT JSON_OBJECT('kind', 'labelLink', 'subscriptionId', B, 'labelId', A)
FROM `_LabelToSubscription`
ORDER BY B, A;
