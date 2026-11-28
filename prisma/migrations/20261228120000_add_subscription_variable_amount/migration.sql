-- pre-migrate: retry-safe
-- 定期払いに「金額は毎回変わる」の指定を持たせる（#1667）。
-- ADD COLUMN IF NOT EXISTS は MySQL 8.0 に無いので、列が無いときだけ PREPARE で追加する（何度流しても同じ結果になる）。
SET @subscription_variable_ddl = IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Subscription' AND COLUMN_NAME = 'variableAmount') = 0,
    'ALTER TABLE `Subscription` ADD COLUMN `variableAmount` BOOLEAN NOT NULL DEFAULT false',
    'SELECT 1'
);
PREPARE subscription_variable_stmt FROM @subscription_variable_ddl;
EXECUTE subscription_variable_stmt;
DEALLOCATE PREPARE subscription_variable_stmt;
