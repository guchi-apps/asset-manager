import { groupRowsByYear, numberOf, type ChartRow } from "@/lib/payroll/chart-data";
import type { BonusDTO, SalaryDTO } from "@/lib/payroll/types";

// 給与・賞与の統合ページ（Issue #1182）で使う、給与と賞与を合わせて扱う純関数。
// クライアントからも import するため `db` に依存させない。

/** 推移グラフの表示。給与別＝給与の月別、賞与別＝賞与の月別、年別＝給与と賞与を合算した年ごと */
export type PayrollChartMode = "salary" | "bonus" | "yearly";

export type PayrollEntry =
  | { kind: "salary"; id: string; date: string; gross: number; net: number; salary: SalaryDTO }
  | { kind: "bonus"; id: string; date: string; gross: number; net: number; bonus: BonusDTO };

/** 給与と賞与を支給日の新しい順に1本へ並べる。同じ日は給与を先にする */
export function mergePayrollEntries(salaries: SalaryDTO[], bonuses: BonusDTO[]): PayrollEntry[] {
  const entries: PayrollEntry[] = [
    ...salaries.map((salary): PayrollEntry => ({
      kind: "salary",
      id: salary.id,
      date: salary.salaryDate,
      gross: Number(salary.grossSalary),
      net: Number(salary.netSalary),
      salary,
    })),
    ...bonuses.map((bonus): PayrollEntry => ({
      kind: "bonus",
      id: bonus.id,
      date: bonus.bonusDate,
      gross: Number(bonus.amount),
      net: numberOf(bonus.data.netAmount),
      bonus,
    })),
  ];
  return entries.sort((a, b) => {
    const diff = new Date(b.date).getTime() - new Date(a.date).getTime();
    if (diff !== 0) return diff;
    if (a.kind === b.kind) return 0;
    return a.kind === "salary" ? -1 : 1;
  });
}

export type PayrollYearlyValues = { 給与: number; 賞与: number; 手取り額: number };

/** 年別グラフ用。給与と賞与を同じ年で合算し、年の昇順で返す（手取り額は両方の合計） */
export function buildPayrollYearlyRows(
  salaries: SalaryDTO[],
  bonuses: BonusDTO[]
): ChartRow<PayrollYearlyValues>[] {
  const rows: ChartRow<PayrollYearlyValues>[] = [
    ...salaries.map((s) => ({
      date: new Date(s.salaryDate),
      values: { 給与: Number(s.grossSalary), 賞与: 0, 手取り額: Number(s.netSalary) },
    })),
    ...bonuses.map((b) => ({
      date: new Date(b.bonusDate),
      values: { 給与: 0, 賞与: Number(b.amount), 手取り額: numberOf(b.data.netAmount) },
    })),
  ];
  return groupRowsByYear(rows);
}
