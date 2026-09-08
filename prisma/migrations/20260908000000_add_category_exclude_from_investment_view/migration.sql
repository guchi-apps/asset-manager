-- Issue #404: ダッシュボードのグラフで投資用資金の増減だけを見たいとき、生活防衛費など
-- 投資対象ではないカテゴリを除外できるようにする。既存カテゴリは false で入るため、
-- この列を足しても現状の集計結果（含める＝現状どおり）は変わらない。
-- AlterTable
ALTER TABLE `Category` ADD COLUMN `excludeFromInvestmentView` BOOLEAN NOT NULL DEFAULT false;
