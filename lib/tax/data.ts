// 年次税務の読み出し（サーバー専用）。全クエリに `userId` 条件を入れる。
// 明細行から集計値を出す純粋な計算は `aggregate.ts` にある（DB なしで単体テストするため）。
// 計算の本体は明細ラボの `annualTaxData.ts` と同じで、`prisma.item` を `prisma.payItem` に読み替えただけ。
import { prisma } from "@/lib/prisma";
import { toItemMap } from "@/lib/payroll/item-snapshot";
import {
  RESIDENT_TAX_BREAKDOWN_FIELDS,
  type ResidentTaxBreakdownField,
  type ResidentTaxOverrides,
} from "./annual-tax";
import {
  computeAnnualAggregate,
  computeFurusatoNozeiIncomeProjection,
  type AnnualAggregate,
  type CurrentItems,
  type FurusatoNozeiIncomeProjection,
} from "./aggregate";
import { withAdjustment, type DonationSummary } from "./donation";
import { getDonationDetails, getDonationYears } from "./donation-source";
import type { DeductionType } from "./types";

async function getCurrentItems(userId: string): Promise<CurrentItems> {
  const items = await prisma.payItem.findMany({
    where: { userId },
    select: { id: true, itemName: true, itemType: true, isTaxable: true },
  });
  return toItemMap(items);
}

export async function getAnnualAggregate(userId: string, year: number): Promise<AnnualAggregate> {
  const gte = new Date(`${year}-01-01`);
  const lt = new Date(`${year + 1}-01-01`);

  const [salaries, bonuses, currentItems] = await Promise.all([
    prisma.salary.findMany({
      where: { userId, deletedAt: null, salaryDate: { gte, lt } },
      select: { grossSalary: true, data: true },
    }),
    prisma.bonus.findMany({
      where: { userId, deletedAt: null, bonusDate: { gte, lt } },
      select: { amount: true, data: true },
    }),
    getCurrentItems(userId),
  ]);

  return computeAnnualAggregate(salaries, bonuses, currentItems);
}

export async function getFurusatoNozeiIncomeProjection(
  userId: string,
  year: number
): Promise<FurusatoNozeiIncomeProjection> {
  const gte = new Date(`${year}-01-01`);
  const lt = new Date(`${year + 1}-01-01`);
  const prevGte = new Date(`${year - 1}-01-01`);

  const [salaries, bonuses, prevBonuses, currentItems] = await Promise.all([
    prisma.salary.findMany({
      where: { userId, deletedAt: null, salaryDate: { gte, lt } },
      select: { salaryDate: true, grossSalary: true, data: true },
      orderBy: { salaryDate: "asc" },
    }),
    prisma.bonus.findMany({
      where: { userId, deletedAt: null, bonusDate: { gte, lt } },
      select: { bonusDate: true, amount: true, data: true },
    }),
    prisma.bonus.findMany({
      where: { userId, deletedAt: null, bonusDate: { gte: prevGte, lt: gte } },
      select: { bonusDate: true, amount: true, data: true },
    }),
    getCurrentItems(userId),
  ]);

  return computeFurusatoNozeiIncomeProjection(salaries, bonuses, prevBonuses, currentItems);
}

/** 保存済みの手動上書きが全項目揃っていれば「確定済み」（明細ラボの `isLocked` と同じ判定） */
export function isYearLocked(overrideIds: Partial<Record<ResidentTaxBreakdownField, string>>): boolean {
  return RESIDENT_TAX_BREAKDOWN_FIELDS.every((field) => overrideIds[field] !== undefined);
}

export type TaxYearData = {
  year: number;
  amounts: Partial<Record<DeductionType, number>>;
  overrides: ResidentTaxOverrides;
  isLocked: boolean;
  aggregate: AnnualAggregate;
  projection: FurusatoNozeiIncomeProjection;
  donationSummary: DonationSummary;
};

/** 年チップに出す年。データのある年に、いま開いている年を足して新しい順に並べる */
export async function getTaxYears(userId: string, requestedYear: number): Promise<{ years: number[]; dataYears: number[] }> {
  const [salaries, bonuses, deductions, overrides, donationYears] = await Promise.all([
    prisma.salary.findMany({ where: { userId, deletedAt: null }, select: { salaryDate: true } }),
    prisma.bonus.findMany({ where: { userId, deletedAt: null }, select: { bonusDate: true } }),
    prisma.deduction.findMany({ where: { userId }, select: { year: true } }),
    prisma.taxCalculationOverride.findMany({ where: { userId }, select: { year: true } }),
    getDonationYears(userId),
  ]);

  const dataYears = new Set<number>();
  for (const s of salaries) dataYears.add(s.salaryDate.getFullYear());
  for (const b of bonuses) dataYears.add(b.bonusDate.getFullYear());
  for (const d of deductions) dataYears.add(d.year);
  for (const o of overrides) dataYears.add(o.year);
  for (const y of donationYears) dataYears.add(y);

  const years = Array.from(new Set([...dataYears, requestedYear])).sort((a, b) => b - a);
  return { years, dataYears: Array.from(dataYears).sort((a, b) => b - a) };
}

export async function getTaxYearData(userId: string, year: number): Promise<TaxYearData> {
  const [deductions, overrideRows, aggregate, projection, donationDetails] = await Promise.all([
    prisma.deduction.findMany({ where: { userId, year } }),
    prisma.taxCalculationOverride.findMany({ where: { userId, year } }),
    getAnnualAggregate(userId, year),
    getFurusatoNozeiIncomeProjection(userId, year),
    getDonationDetails(userId, [year]),
  ]);

  const amounts: Partial<Record<DeductionType, number>> = {};
  for (const d of deductions) amounts[d.deductionType as DeductionType] = Number(d.amount);

  const overrides: ResidentTaxOverrides = {};
  const overrideIds: Partial<Record<ResidentTaxBreakdownField, string>> = {};
  for (const o of overrideRows) {
    const field = o.field as ResidentTaxBreakdownField;
    overrides[field] = Number(o.amount);
    overrideIds[field] = o.id;
  }

  return {
    year,
    amounts,
    overrides,
    isLocked: isYearLocked(overrideIds),
    aggregate,
    projection,
    // 寄付済額は 明細合計 + 調整額。調整額は Deduction.furusatoNozei だけを見る
    donationSummary: withAdjustment(donationDetails[year]!, amounts.furusatoNozei ?? 0),
  };
}

/** 確定済み（全項目の上書きが揃っている）の年。年チップのバッジに使う */
export async function getLockedYears(userId: string): Promise<number[]> {
  const rows = await prisma.taxCalculationOverride.groupBy({
    by: ["year"],
    where: { userId },
    _count: { field: true },
  });
  return rows.filter((r) => r._count.field >= RESIDENT_TAX_BREAKDOWN_FIELDS.length).map((r) => r.year);
}
