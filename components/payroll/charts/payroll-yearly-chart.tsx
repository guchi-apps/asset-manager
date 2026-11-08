"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import type { BonusDTO, SalaryDTO } from "@/lib/payroll/types";
import { EARNING_COLORS, NET_LINE_COLOR, resolveColor } from "./chart-colors";
import { estimateYAxisWidth, formatAxisTick } from "@/lib/payroll/chart-data";
import { buildPayrollYearlyRows } from "@/lib/payroll/combined";
import { ChartFrame } from "./chart-frame";
import { ChartLegend } from "./chart-legend";
import { useIsDarkTheme } from "./use-is-dark-theme";

// 給与と賞与を合算した年別の支給額の推移（Issue #1182）。給与＝青、賞与＝黄（明細一覧の賞与バッジと同系色）
const SERIES = [
  { key: "給与", color: EARNING_COLORS[0] },
  { key: "賞与", color: EARNING_COLORS[2] },
] as const;

export function PayrollYearlyChart({
  salaries,
  bonuses,
}: {
  salaries: SalaryDTO[];
  bonuses: BonusDTO[];
}) {
  const isDark = useIsDarkTheme();

  const data = useMemo(
    () =>
      buildPayrollYearlyRows(salaries, bonuses).map((row) => ({
        date: format(row.date, "yyyy"),
        ...row.values,
      })),
    [salaries, bonuses]
  );

  if (data.length === 0) {
    return (
      <div className="flex h-[300px] w-full items-center justify-center text-sm text-muted-foreground md:h-[400px]">
        データがありません
      </div>
    );
  }

  const legendItems = [
    ...SERIES.map((s) => ({ name: s.key, color: resolveColor(s.color, isDark) })),
    { name: "手取り額", color: resolveColor(NET_LINE_COLOR, isDark) },
  ];
  const yAxisWidth = estimateYAxisWidth(data.flatMap((row) => [row.給与 + row.賞与, row.手取り額]));

  return (
    <div>
      <ChartFrame itemCount={data.length} yAxisWidth={yAxisWidth} viewMode="yearly">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" padding={{ left: 12 }} tick={{ fill: "var(--muted-foreground)" }} axisLine={{ stroke: "var(--border)" }} tickLine={{ stroke: "var(--border)" }} />
            <YAxis
              width={yAxisWidth}
              tick={{ fill: "var(--muted-foreground)" }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={{ stroke: "var(--border)" }}
              tickFormatter={formatAxisTick}
            />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.key} stackId="earning" fill={resolveColor(s.color, isDark)} />
            ))}
            <Line
              type="linear"
              dataKey="手取り額"
              name="手取り額"
              stroke={resolveColor(NET_LINE_COLOR, isDark)}
              strokeWidth={2}
              dot={false}
              activeDot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartFrame>
      <ChartLegend items={legendItems} />
    </div>
  );
}
