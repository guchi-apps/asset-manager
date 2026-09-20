-- AlterTable
-- プラン名を変更理由（memo）から分ける（Issue #525）。
ALTER TABLE `SubscriptionPrice` ADD COLUMN `planName` VARCHAR(100) NULL;

-- 解約予定を、自動更新かどうかとは別に持つ（Issue #525）。
ALTER TABLE `Subscription` ADD COLUMN `cancelPlanned` BOOLEAN NOT NULL DEFAULT false;

-- これまで memo は「プラン名・変更理由」の1つの欄で、適用中の料金の memo が一覧の「プラン」として
-- 表示されていた。見え方を変えないため、100文字以内のものはプラン名へ移して memo を空にする。
-- 100文字を超えるものは長い変更理由とみなし、memo に残す（プラン名は空になる）。
UPDATE `SubscriptionPrice`
SET `planName` = TRIM(`memo`), `memo` = NULL
WHERE `memo` IS NOT NULL AND TRIM(`memo`) <> '' AND CHAR_LENGTH(TRIM(`memo`)) <= 100;

-- これまで「終了日が未定で自動更新しない」契約は解約予定として扱っていた。表示を変えないよう、
-- その契約は解約予定のまま移す（終了日がある契約は、終了日から解約予定と判定されるので触らない）。
UPDATE `Subscription` SET `cancelPlanned` = true WHERE `endDate` IS NULL AND `autoRenew` = false;
