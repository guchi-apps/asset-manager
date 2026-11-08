"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BonusEarningChart } from "@/components/payroll/charts/bonus-earning-chart";
import { PayrollYearlyChart } from "@/components/payroll/charts/payroll-yearly-chart";
import { SalaryEarningChart } from "@/components/payroll/charts/salary-earning-chart";
import { PayrollChartModeToggle } from "@/components/payroll/charts/view-mode-toggle";
import { PayrollSummary } from "@/components/payroll/payroll-summary";
import { PayrollTimeline } from "@/components/payroll/payroll-timeline";
import type { PayrollChartMode } from "@/lib/payroll/combined";
import type { BonusDTO, ItemDTO, SalaryDTO } from "@/lib/payroll/types";

const CHART_TITLES: Record<PayrollChartMode, string> = {
  salary: "支給額の推移（給与・月別）",
  bonus: "支給額の推移（賞与・月別）",
  yearly: "支給額の推移（給与と賞与の合算・年別）",
};

// 給与・賞与の統合ページの本体（Issue #1182。明細ラボの salaries-client.tsx から移管した #714 を統合）
export function SalariesContent({
  salaries,
  bonuses,
  items,
}: {
  salaries: SalaryDTO[];
  bonuses: BonusDTO[];
  items: ItemDTO[];
}) {
  const [mode, setMode] = useState<PayrollChartMode>("yearly");

  return (
    <div className="space-y-4">
      <PayrollSummary salaries={salaries} bonuses={bonuses} />

      <PayrollChartModeToggle value={mode} onChange={setMode} />

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>{CHART_TITLES[mode]}</CardTitle>
        </CardHeader>
        <CardContent>
          {mode === "salary" && <SalaryEarningChart salaries={salaries} items={items} viewMode="monthly" />}
          {mode === "bonus" && <BonusEarningChart bonuses={bonuses} items={items} viewMode="monthly" />}
          {mode === "yearly" && <PayrollYearlyChart salaries={salaries} bonuses={bonuses} />}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button asChild variant="outline">
          <Link href="/salaries/new">PDFから登録</Link>
        </Button>
        <Button asChild>
          <Link href="/salaries/new">給与を登録</Link>
        </Button>
        <Button asChild>
          <Link href="/bonuses/new">賞与を登録</Link>
        </Button>
      </div>

      <PayrollTimeline salaries={salaries} bonuses={bonuses} items={items} />

      <p className="text-xs text-muted-foreground">
        給与・賞与の登録は、資産の評価額や家計簿（Zaim）の取引には反映されません。
      </p>
    </div>
  );
}
