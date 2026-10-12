"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";

import type { BonusDTO, ItemDTO } from "@/lib/payroll/types";
import { DEDUCTION_COLORS, resolveColor } from "./chart-colors";
import { buildDeductionRow, estimateYAxisWidth, formatAxisTick, groupRowsByYear, type ChartViewMode } from "@/lib/payroll/chart-data";
import { ChartFrame } from "./chart-frame";
import { ChartLegend } from "./chart-legend";
import { useIsDarkTheme } from "./use-is-dark-theme";

const DEDUCTION_KEYS = ["法定控除", "控除"] as const;

export function BonusDeductionChart({
  bonuses,
  items,
  viewMode,
}: {
  bonuses: BonusDTO[];
  items: ItemDTO[];
  viewMode: ChartViewMode;
}) {
  const isDark = useIsDarkTheme();

  const rows = useMemo(
    () =>
      [...bonuses]
        .sort((a, b) => new Date(a.bonusDate).getTime() - new Date(b.bonusDate).getTime())
        .map((bonus) => ({
          date: new Date(bonus.bonusDate),
          values: buildDeductionRow(bonus.data, items),
        })),
    [bonuses, items]
  );

  const data = useMemo(() => {
    const groupedRows = viewMode === "yearly" ? groupRowsByYear(rows) : rows;
    return groupedRows.map((row) => ({
      date: format(row.date, viewMode === "yearly" ? "yyyy" : "yy/MM"),
      ...row.values,
    }));
  }, [rows, viewMode]);

  if (data.length === 0) {
    return (
      <div className="flex h-[300px] w-full items-center justify-center text-sm text-muted-foreground md:h-[400px]">
        データがありません
      </div>
    );
  }

  const legendItems = DEDUCTION_KEYS.map((key, i) => ({ name: key, color: resolveColor(DEDUCTION_COLORS[i], isDark) }));

  const yAxisWidth = estimateYAxisWidth(data.map((row) => DEDUCTION_KEYS.reduce((sum, key) => sum + row[key], 0)));

  return (
    <div>
      <ChartFrame itemCount={data.length} yAxisWidth={yAxisWidth} viewMode={viewMode}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)" }} axisLine={{ stroke: "var(--border)" }} tickLine={{ stroke: "var(--border)" }} />
            <YAxis
              width={yAxisWidth}
              tick={{ fill: "var(--muted-foreground)" }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={{ stroke: "var(--border)" }}
              tickFormatter={formatAxisTick}
            />
            {DEDUCTION_KEYS.map((key, i) => (
              <Bar key={key} dataKey={key} name={key} stackId="deduction" fill={resolveColor(DEDUCTION_COLORS[i], isDark)} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ChartLegend items={legendItems} />
    </div>
  );
}
