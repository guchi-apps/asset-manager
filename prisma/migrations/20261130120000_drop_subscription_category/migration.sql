-- 定期払いの区分（category）を廃止する（Issue #1350）
-- 分割払いは区分が INSTALLMENT の契約だけが支払回数を持っていた。区分が無くなると回数の有無だけで
-- 分割払いと判定するため、念のため分割払い以外の行と、手入力の終了日を持つ行（従来は終了日が優先）の回数を先に消してから列を落とす。
UPDATE `Subscription` SET `installmentCount` = NULL WHERE `category` <> 'INSTALLMENT' OR `endDate` IS NOT NULL;
ALTER TABLE `Subscription` DROP COLUMN `category`;
