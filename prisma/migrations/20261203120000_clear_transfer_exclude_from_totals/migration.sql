-- Issue #1434: 振替の「集計に含めない」を外す。
-- 振替は種類だけで収支から外れ、このフラグは証券口座宛ての「投資へ」を黙って 0 にするだけ。
-- Zaim の振替は calc_flag = 0 で届くため、取り込み元のフラグがそのまま写っていた。
-- 次の行は変換しない:
--   ・手で付けた行（sourceProvider が無い手入力、または editedFields に excludeFromTotals がある）
--   ・情報源にした口座名の取引（二重計上を防ぐために applySourceMappings が付けた。editedFields は足されない）
-- MariaDB・MySQL 8.0 のどちらでも通るよう、JSON 関数は使わず LIKE で判定する。
UPDATE `LedgerEntry` e
SET e.`excludeFromTotals` = false
WHERE e.`kind` = 'TRANSFER'
  AND e.`excludeFromTotals` = true
  AND e.`sourceProvider` IS NOT NULL
  AND (e.`editedFields` IS NULL OR e.`editedFields` NOT LIKE '%"excludeFromTotals"%')
  AND NOT EXISTS (
    SELECT 1 FROM `LedgerSourceAccountMapping` m
    WHERE m.`userId` = e.`userId`
      AND m.`provider` = e.`sourceProvider`
      AND m.`target` = 'INFO_SOURCE'
      AND m.`externalName` = e.`sourceFromName`
  );
