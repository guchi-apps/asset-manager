import { INCOME_TAX_ADJUSTMENT_ITEM_NAMES } from "@/lib/payroll/types";
import type { ItemDTO } from "@/lib/payroll/types";

export function numberOf(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

export function formatManYen(value: number): string {
  return (value / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function formatAxisTick(value: number): string {
  return formatManYen(value);
}

const AXIS_CHAR_WIDTH = 7; // 目盛ラベル1文字あたりの概算幅(px)
const AXIS_LABEL_PADDING = 14; // 目盛線とラベルの間の余白(px)
const MIN_Y_AXIS_WIDTH = 28;

// グラフごとに実際に表示されうる値の桁数から縦軸の必要幅を見積もる。
// 固定幅にすると値が小さいグラフで余白が過大になるため、グラフごとに算出する。
export function estimateYAxisWidth(values: number[]): number {
  const maxLabelLength = values.reduce((max, value) => Math.max(max, formatAxisTick(value).length), 0);
  return Math.max(MIN_Y_AXIS_WIDTH, maxLabelLength * AXIS_CHAR_WIDTH + AXIS_LABEL_PADDING);
}

export function customValue(data: Record<string, unknown>, itemId: string): number {
  const customValues = data.customItemValues;
  if (!customValues || typeof customValues !== "object") return 0;
  const value = (customValues as Record<string, unknown>)[itemId];
  return typeof value === "number" ? value : 0;
}

export function sumCustomValues(data: Record<string, unknown>, items: ItemDTO[]): number {
  return items.reduce((sum, item) => sum + customValue(data, item.id), 0);
}

function sumFixedKeys(data: Record<string, unknown>, keys: string[]): number {
  return keys.reduce((sum, key) => sum + numberOf(data[key]), 0);
}

const STATUTORY_DEDUCTION_KEYS = ["healthInsurance", "pension", "employmentInsurance", "incomeTax", "residentTax"];
const DEDUCTION_KEYS = ["otherDeduction"];

const STATUTORY_DEDUCTION_LABELS: Record<string, string> = {
  healthInsurance: "健康保険料",
  pension: "厚生年金保険料",
  employmentInsurance: "雇用保険料",
  incomeTax: "所得税",
  residentTax: "住民税",
};

const DEDUCTION_LABELS: Record<string, string> = {
  otherDeduction: "その他控除",
};

export type BreakdownItem = { name: string; value: number };

function fixedKeyBreakdown(
  data: Record<string, unknown>,
  keys: string[],
  labels: Record<string, string>
): BreakdownItem[] {
  return keys
    .map((key) => ({ name: labels[key], value: Math.abs(numberOf(data[key])) }))
    .filter((item) => item.value > 0);
}

// 控除系の内訳は常にマイナス値のため、絶対値にして正の金額として表示する。
// 支給系の内訳(その他支給等)は精算項目のようにマイナス値もあり得るため、符号を保持する。
// 年末調整・所得税(差額)項目は控除系でも追加徴収/還付の両方があり得るため、符号を保持する。
function customItemBreakdown(
  data: Record<string, unknown>,
  items: ItemDTO[],
  { absolute = true }: { absolute?: boolean } = {}
): BreakdownItem[] {
  return items
    .map((item) => {
      const raw = customValue(data, item.id);
      const useAbsolute = absolute && !INCOME_TAX_ADJUSTMENT_ITEM_NAMES.includes(item.itemName);
      return { name: item.itemName, value: useAbsolute ? Math.abs(raw) : raw };
    })
    .filter((item) => item.value !== 0);
}

export function buildDeductionRow(
  data: Record<string, unknown>,
  items: ItemDTO[]
): { 法定控除: number; 控除: number } {
  const statutoryItems = items.filter((item) => item.itemType === "statutoryDeduction");
  const deductionItems = items.filter((item) => item.itemType === "deduction");
  return {
    法定控除: Math.abs(sumFixedKeys(data, STATUTORY_DEDUCTION_KEYS) + sumCustomValues(data, statutoryItems)),
    控除: Math.abs(sumFixedKeys(data, DEDUCTION_KEYS) + sumCustomValues(data, deductionItems)),
  };
}

export function buildStatutoryDeductionItems(data: Record<string, unknown>, items: ItemDTO[]): BreakdownItem[] {
  const statutoryItems = items.filter((item) => item.itemType === "statutoryDeduction");
  return [
    ...fixedKeyBreakdown(data, STATUTORY_DEDUCTION_KEYS, STATUTORY_DEDUCTION_LABELS),
    ...customItemBreakdown(data, statutoryItems),
  ];
}

export function buildDeductionItems(data: Record<string, unknown>, items: ItemDTO[]): BreakdownItem[] {
  const deductionItems = items.filter((item) => item.itemType === "deduction");
  return [...fixedKeyBreakdown(data, DEDUCTION_KEYS, DEDUCTION_LABELS), ...customItemBreakdown(data, deductionItems)];
}

export function buildSalaryEarningRow(
  data: Record<string, unknown>,
  items: ItemDTO[]
): { 本給: number; 超勤手当: number; 通勤手当: number; その他支給: number } {
  const commuteItem = items.find((item) => item.itemType === "earning" && item.itemName === "通勤手当");
  const otherEarningItems = items.filter((item) => item.itemType === "earning" && item.id !== commuteItem?.id);
  const otherEarningOnlyItems = items.filter((item) => item.itemType === "otherEarning");
  return {
    本給: numberOf(data.baseGrossSalary),
    超勤手当: numberOf(data.overtime),
    通勤手当: commuteItem ? customValue(data, commuteItem.id) : 0,
    その他支給: sumCustomValues(data, otherEarningItems) + sumCustomValues(data, otherEarningOnlyItems),
  };
}

export function buildSalaryOtherEarningItems(data: Record<string, unknown>, items: ItemDTO[]): BreakdownItem[] {
  const commuteItem = items.find((item) => item.itemType === "earning" && item.itemName === "通勤手当");
  const otherEarningItems = items.filter((item) => item.itemType === "earning" && item.id !== commuteItem?.id);
  const otherEarningOnlyItems = items.filter((item) => item.itemType === "otherEarning");
  return customItemBreakdown(data, [...otherEarningItems, ...otherEarningOnlyItems], { absolute: false });
}

export function buildBonusEarningRow(
  data: Record<string, unknown>,
  items: ItemDTO[]
): { "賞与支給(勤怠減額後)": number; "将来設計準備金 DC差引後": number; その他支給: number } {
  const earningItems = items.filter((item) => item.itemType === "earning");
  const otherEarningItems = items.filter((item) => item.itemType === "otherEarning");
  return {
    "賞与支給(勤怠減額後)": numberOf(data.attendanceAdjustedAmount),
    "将来設計準備金 DC差引後": numberOf(data.futureDesignReserveAmount) + numberOf(data.dcPensionContribution),
    その他支給: sumCustomValues(data, earningItems) + sumCustomValues(data, otherEarningItems),
  };
}

export function buildBonusOtherEarningItems(data: Record<string, unknown>, items: ItemDTO[]): BreakdownItem[] {
  const earningItems = items.filter((item) => item.itemType === "earning");
  const otherEarningItems = items.filter((item) => item.itemType === "otherEarning");
  return customItemBreakdown(data, [...earningItems, ...otherEarningItems], { absolute: false });
}

export type ChartViewMode = "monthly" | "yearly";

export type ChartRow<T extends Record<string, number>> = { date: Date; values: T };

// 年別表示では、同じ年のデータを合算して年ごとの値にする。
export function groupRowsByYear<T extends Record<string, number>>(rows: ChartRow<T>[]): ChartRow<T>[] {
  const summed = new Map<number, T>();
  for (const row of rows) {
    const year = row.date.getFullYear();
    const existing = summed.get(year);
    if (!existing) {
      summed.set(year, { ...row.values });
      continue;
    }
    for (const key of Object.keys(row.values) as (keyof T)[]) {
      existing[key] = (existing[key] + row.values[key]) as T[keyof T];
    }
  }
  return [...summed.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, values]) => ({ date: new Date(year, 0, 1), values }));
}

export function buildBonusFutureDesignReserveItems(data: Record<string, unknown>): BreakdownItem[] {
  return [
    { name: "将来設計準備金基準額", value: numberOf(data.futureDesignReserveAmount) },
    { name: "確定拠出年金掛金", value: numberOf(data.dcPensionContribution) },
  ].filter((item) => item.value !== 0);
}

// 年別の内訳表示では、月ごとの内訳を1年分合算してから表示する。
export function sumRecords<T extends Record<string, number>>(rows: T[]): T {
  const sum = {} as T;
  for (const row of rows) {
    for (const key of Object.keys(row) as (keyof T)[]) {
      sum[key] = ((sum[key] ?? 0) + row[key]) as T[keyof T];
    }
  }
  return sum;
}

export function sumBreakdownItems(lists: BreakdownItem[][]): BreakdownItem[] {
  const totals = new Map<string, number>();
  for (const list of lists) {
    for (const item of list) {
      totals.set(item.name, (totals.get(item.name) ?? 0) + item.value);
    }
  }
  return [...totals.entries()].map(([name, value]) => ({ name, value }));
}
