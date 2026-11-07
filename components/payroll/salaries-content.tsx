"use client";

import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SalaryEarningChart } from "@/components/payroll/charts/salary-earning-chart";
import { ChartViewModeToggle } from "@/components/payroll/charts/view-mode-toggle";
import { PayrollSummary } from "@/components/payroll/payroll-summary";
import { SalaryList } from "@/components/payroll/salary-list";
import type { ChartViewMode } from "@/lib/payroll/chart-data";
import type { BonusDTO, ItemDTO, SalaryDTO } from "@/lib/payroll/types";

// 給与一覧の本体（明細ラボの salaries-client.tsx から移管。#714）
export function SalariesContent({
  salaries,
  bonuses,
  items,
}: {
  salaries: SalaryDTO[];
  bonuses: BonusDTO[];
  items: ItemDTO[];
}) {
  const [viewMode, setViewMode] = useState<ChartViewMode>("monthly");

  return (
    <div className="space-y-4">
      <PayrollSummary salaries={salaries} bonuses={bonuses} />

      <ChartViewModeToggle value={viewMode} onChange={setViewMode} />

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>支給額の推移</CardTitle>
        </CardHeader>
        <CardContent>
          <SalaryEarningChart salaries={salaries} items={items} viewMode={viewMode} />
        </CardContent>
      </Card>

      <SalaryList salaries={salaries} items={items} viewMode={viewMode} />

      <p className="text-xs text-muted-foreground">
        給与・賞与の登録は、資産の評価額や家計簿（Zaim）の取引には反映されません。
      </p>
    </div>
  );
}
