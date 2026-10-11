"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ChartViewMode } from "@/lib/payroll/chart-data";

export function ChartViewModeToggle({
  value,
  onChange,
}: {
  value: ChartViewMode;
  onChange: (value: ChartViewMode) => void;
}) {
  return (
    <div className="mb-2 flex justify-end">
      <Tabs value={value} onValueChange={(v) => onChange(v as ChartViewMode)}>
        <TabsList>
          <TabsTrigger value="monthly">月別</TabsTrigger>
          <TabsTrigger value="yearly">年別</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
