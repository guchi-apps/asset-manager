"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PayrollChartMode } from "@/lib/payroll/combined";

// 給与別（給与の月別）／賞与別（賞与の月別）／年別（給与と賞与の合算）の切り替え（Issue #1182）
export function PayrollChartModeToggle({
  value,
  onChange,
}: {
  value: PayrollChartMode;
  onChange: (value: PayrollChartMode) => void;
}) {
  return (
    <div className="mb-2 flex justify-end">
      <Tabs value={value} onValueChange={(v) => onChange(v as PayrollChartMode)}>
        <TabsList>
          <TabsTrigger value="salary">給与別</TabsTrigger>
          <TabsTrigger value="bonus">賞与別</TabsTrigger>
          <TabsTrigger value="yearly">年別</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
