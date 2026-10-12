"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import type { BonusDTO, ItemDTO } from "@/lib/payroll/types";
import { EARNING_COLORS, NET_LINE_COLOR, resolveColor } from "./chart-colors";
import {
  buildBonusEarningRow,
  estimateYAxisWidth,
  formatAxisTick,
  groupRowsByYear,
  numberOf,
  type ChartViewMode,
} from "@/lib/payroll/chart-data";
import { ChartFrame } from "./chart-frame";
import { ChartLegend } from "./chart-legend";
import { useIsDarkTheme } from "./use-is-dark-theme";

const EARNING_KEYS = ["賞与支給(勤怠減額後)", "将来設計準備金 DC差引後", "その他支給"] as const;

export function BonusEarningChart({
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
          values: { ...buildBonusEarningRow(bonus.data, items), 手取り額: numberOf(bonus.data.netAmount) },
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

  const legendItems = [
    ...EARNING_KEYS.map((key, i) => ({ name: key, color: resolveColor(EARNING_COLORS[i], isDark) })),
    { name: "手取り額", color: resolveColor(NET_LINE_COLOR, isDark) },
  ];

  const yAxisWidth = estimateYAxisWidth(
    data.flatMap((row) => [EARNING_KEYS.reduce((sum, key) => sum + row[key], 0), row.手取り額])
  );

  return (
    <div>
      <ChartFrame itemCount={data.length} yAxisWidth={yAxisWidth} viewMode={viewMode}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} stackOffset="sign">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fill: "var(--muted-foreground)" }} axisLine={{ stroke: "var(--border)" }} tickLine={{ stroke: "var(--border)" }} />
            <YAxis
              width={yAxisWidth}
              tick={{ fill: "var(--muted-foreground)" }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={{ stroke: "var(--border)" }}
              tickFormatter={formatAxisTick}
            />
            <ReferenceLine y={0} stroke="var(--foreground)" />
            {EARNING_KEYS.map((key, i) => (
              <Bar key={key} dataKey={key} name={key} stackId="earning" fill={resolveColor(EARNING_COLORS[i], isDark)} />
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
