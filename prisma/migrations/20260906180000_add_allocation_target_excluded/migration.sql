-- Issue #388: リバランスの計算から外す項目を指定できるようにする。
-- excluded の行は ratio を 0 で持ち、目標の合計100%にも数えない。
-- 既存の目標配分は false で入るため、この列を足しても計算結果は変わらない。
-- AlterTable
ALTER TABLE `AllocationTarget` ADD COLUMN `excluded` BOOLEAN NOT NULL DEFAULT false;
