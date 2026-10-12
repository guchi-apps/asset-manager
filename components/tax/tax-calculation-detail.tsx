"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Info, TriangleAlert } from "lucide-react";

import {
  calculateAnnualResidentTax,
  RESIDENT_TAX_BREAKDOWN_FIELDS,
  type AnnualResidentTaxBreakdown,
  type ResidentTaxBreakdownField,
  type ResidentTaxOverrides,
} from "@/lib/tax/annual-tax";
import { cn } from "@/lib/utils";
import { AmountInput } from "@/components/payroll/amount-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AutoCalcHint } from "@/components/payroll/auto-calc-hint";
import { lockYear, saveDeductions, saveOverrides, unlockYear } from "@/app/actions/tax";
import type { DonationSummary } from "@/lib/tax/donation";
import type { DeductionType } from "@/lib/tax/types";

type FieldMeta = {
  field: ResidentTaxBreakdownField;
  label: string;
  formula: string;
  isRate?: boolean;
  renderExtra?: (
    breakdown: AnnualResidentTaxBreakdown,
    amounts: Partial<Record<DeductionType, number>>
  ) => React.ReactNode;
};

type BracketRow = { max: number | null; label: string; value: string };

function buildBracketRows(defs: { max: number | null; value: string }[]): BracketRow[] {
  return defs.map((def, i) => {
    const prevMax = i > 0 ? defs[i - 1].max : null;
    const label =
      prevMax === null
        ? `${def.max!.toLocaleString()}円未満`
        : def.max !== null
          ? `${prevMax.toLocaleString()}円以上 ${def.max.toLocaleString()}円未満`
          : `${prevMax.toLocaleString()}円以上`;
    return { max: def.max, label, value: def.value };
  });
}

function BracketTable({ rows, activeValue }: { rows: BracketRow[]; activeValue: number }) {
  const activeIndex = (() => {
    const idx = rows.findIndex((r) => r.max !== null && activeValue < r.max);
    return idx === -1 ? rows.length - 1 : idx;
  })();
  return (
    <table className="mt-2 w-full text-xs">
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={r.label}
            className={cn("border-t first:border-t-0", i === activeIndex && "bg-primary/10 font-semibold")}
          >
            <td className="py-1 pr-3 text-muted-foreground">{r.label}</td>
            <td className="py-1 text-right whitespace-nowrap">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 生命保険料控除(新制度)の速算表。区分ごとに控除額の求め方が異なるため、
// 該当区分の計算式を表示する
type LifeInsuranceThresholds = { first: number; second: number; third: number };

function buildLifeInsuranceRows(thresholds: LifeInsuranceThresholds) {
  const { first, second, third } = thresholds;
  const tier2Add = first / 2;
  const tier3Add = first / 2 + second / 4;
  const capAmount = first / 2 + second / 4 + third / 4;
  return [
    { max: first, label: `${first.toLocaleString()}円以下`, formula: "支払保険料の全額" },
    {
      max: second,
      label: `${first.toLocaleString()}円超 ${second.toLocaleString()}円以下`,
      formula: `支払保険料 × 1/2 + ${tier2Add.toLocaleString()}円`,
    },
    {
      max: third,
      label: `${second.toLocaleString()}円超 ${third.toLocaleString()}円以下`,
      formula: `支払保険料 × 1/4 + ${tier3Add.toLocaleString()}円`,
    },
    { max: null, label: `${third.toLocaleString()}円超`, formula: `一律 ${capAmount.toLocaleString()}円` },
  ];
}

const LIFE_INSURANCE_INCOME_TAX_ROWS = buildLifeInsuranceRows({
  first: 20000,
  second: 40000,
  third: 80000,
});
const LIFE_INSURANCE_RESIDENT_TAX_ROWS = buildLifeInsuranceRows({
  first: 12000,
  second: 32000,
  third: 56000,
});

function LifeInsuranceDeductionTable({
  rows,
  premium,
}: {
  rows: ReturnType<typeof buildLifeInsuranceRows>;
  premium: number;
}) {
  const activeIndex = (() => {
    const idx = rows.findIndex((r) => r.max !== null && premium <= r.max);
    return idx === -1 ? rows.length - 1 : idx;
  })();
  return (
    <table className="mt-2 w-full text-xs">
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={r.label}
            className={cn(
              "border-t first:border-t-0 align-top",
              i === activeIndex && "bg-primary/10 font-semibold"
            )}
          >
            <td className="py-1 pr-3 text-muted-foreground">{r.label}</td>
            <td className="py-1 text-right whitespace-nowrap">{r.formula}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 給与所得額に応じた所得税の基礎控除額(令和7年分以降)
const BASIC_DEDUCTION_INCOME_TAX_BRACKETS = buildBracketRows([
  { max: 1320000, value: "950,000円" },
  { max: 3360000, value: "880,000円" },
  { max: 4890000, value: "680,000円" },
  { max: 6550000, value: "630,000円" },
  { max: 23500000, value: "580,000円" },
  { max: 24000000, value: "480,000円" },
  { max: 24500000, value: "320,000円" },
  { max: 25000000, value: "160,000円" },
  { max: null, value: "0円" },
]);

// 給与所得額に応じた住民税の基礎控除額
const BASIC_DEDUCTION_RESIDENT_TAX_BRACKETS = buildBracketRows([
  { max: 24000000, value: "430,000円" },
  { max: 24500000, value: "290,000円" },
  { max: 25000000, value: "150,000円" },
  { max: null, value: "0円" },
]);

// 課税される所得金額に応じた所得税率の速算表
const INCOME_TAX_RATE_BRACKETS = buildBracketRows([
  { max: 1950000, value: "5%" },
  { max: 3300000, value: "10%" },
  { max: 6950000, value: "20%" },
  { max: 9000000, value: "23%" },
  { max: 18000000, value: "33%" },
  { max: 40000000, value: "40%" },
  { max: null, value: "45%" },
]);

// 所得税額の累進課税の速算式(税率と同じ境界値)
const INCOME_TAX_MARGINAL_BRACKETS = [
  { max: 1950000, rate: 0.05 },
  { max: 3300000, rate: 0.1 },
  { max: 6950000, rate: 0.2 },
  { max: 9000000, rate: 0.23 },
  { max: 18000000, rate: 0.33 },
  { max: 40000000, rate: 0.4 },
  { max: null, rate: 0.45 },
];

function IncomeTaxAmountBreakdown({ taxableIncome }: { taxableIncome: number }) {
  let lower = 0;
  const rows: { range: string; amount: number; rate: number; tax: number }[] = [];
  for (const bracket of INCOME_TAX_MARGINAL_BRACKETS) {
    const upper = bracket.max ?? Infinity;
    const amount = Math.max(Math.min(taxableIncome, upper) - lower, 0);
    if (amount > 0) {
      rows.push({
        range:
          lower === 0
            ? `${bracket.max!.toLocaleString()}円以下`
            : bracket.max !== null
              ? `${lower.toLocaleString()}円超 ${bracket.max.toLocaleString()}円以下`
              : `${lower.toLocaleString()}円超`,
        amount,
        rate: bracket.rate,
        tax: amount * bracket.rate,
      });
    }
    lower = upper;
    if (taxableIncome <= upper) break;
  }
  const total = rows.reduce((sum, r) => sum + r.tax, 0);

  return (
    <table className="mt-2 w-full text-xs">
      <thead>
        <tr className="text-muted-foreground">
          <th className="pb-1 text-left font-normal">対象金額</th>
          <th className="pb-1 text-right font-normal">税率</th>
          <th className="pb-1 text-right font-normal">税額</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.range} className="border-t align-top">
            <td className="py-1 pr-2 text-muted-foreground">
              {r.range}
              <br />
              {r.amount.toLocaleString()} 円
            </td>
            <td className="py-1 text-right">{Math.round(r.rate * 100)}%</td>
            <td className="py-1 text-right whitespace-nowrap">
              {Math.round(r.tax).toLocaleString()} 円
            </td>
          </tr>
        ))}
        <tr className="border-t font-semibold">
          <td className="py-1" colSpan={2}>
            合計
          </td>
          <td className="py-1 text-right whitespace-nowrap">{Math.round(total).toLocaleString()} 円</td>
        </tr>
      </tbody>
    </table>
  );
}

// 資産管理.xlsx「税金計算」シートB列の項目・並び順に合わせている
const SECTIONS: { title: string; fields: FieldMeta[] }[] = [
  {
    title: "共通",
    fields: [
      {
        field: "annualGrossIncome",
        label: "給与",
        formula: "その年に登録された給与・賞与の支給額の合計から、通勤手当等の非課税支給額を除いたもの(自動集計)",
      },
      {
        field: "employmentIncome",
        label: "給与所得額",
        formula: "給与収入の額に応じた給与所得控除後の金額(所得税法の速算式)",
      },
      {
        field: "socialInsuranceTotal",
        label: "社会保険料控除",
        formula: "その年の給与・賞与に登録された健康保険料・厚生年金保険料・雇用保険料の合計(自動集計)",
      },
      {
        field: "furusatoNozeiEffective",
        label: "ふるさと納税 計算値",
        formula: "「ふるさと納税」の年間合計額をそのまま使用",
      },
    ],
  },
  {
    title: "所得税",
    fields: [
      {
        field: "lifeInsuranceGeneralDeductionIncomeTax",
        label: "一般生命保険料(控除額)",
        formula: "一般生命保険料(支払額)から算出した所得税の控除額(新制度の速算表)",
        renderExtra: (_breakdown, amounts) => (
          <LifeInsuranceDeductionTable
            rows={LIFE_INSURANCE_INCOME_TAX_ROWS}
            premium={amounts.lifeInsuranceGeneral ?? 0}
          />
        ),
      },
      {
        field: "lifeInsuranceCareMedicalDeductionIncomeTax",
        label: "介護医療保険料(控除額)",
        formula: "介護医療保険料(支払額)から算出した所得税の控除額(一般生命保険料と同じ速算表)",
        renderExtra: (_breakdown, amounts) => (
          <LifeInsuranceDeductionTable
            rows={LIFE_INSURANCE_INCOME_TAX_ROWS}
            premium={amounts.lifeInsuranceCareMedical ?? 0}
          />
        ),
      },
      {
        field: "lifeInsurancePensionDeductionIncomeTax",
        label: "個人年金保険料(控除額)",
        formula: "個人年金保険料(支払額)から算出した所得税の控除額(一般生命保険料と同じ速算表)",
        renderExtra: (_breakdown, amounts) => (
          <LifeInsuranceDeductionTable
            rows={LIFE_INSURANCE_INCOME_TAX_ROWS}
            premium={amounts.lifeInsurancePension ?? 0}
          />
        ),
      },
      {
        field: "lifeInsuranceForIncomeTax",
        label: "生命保険料控除",
        formula: "一般 + 介護医療 + 個人年金の各控除額(所得税用)の合計",
      },
      {
        field: "basicDeductionForIncomeTax",
        label: "基礎控除",
        formula: "給与所得額に応じた所得税の基礎控除額(令和7年分以降の税制の速算表)",
        renderExtra: (breakdown) => (
          <BracketTable rows={BASIC_DEDUCTION_INCOME_TAX_BRACKETS} activeValue={breakdown.employmentIncome.auto} />
        ),
      },
      {
        field: "furusatoDeductionForIncomeTax",
        label: "寄付金控除(ふるさと納税分)",
        formula: "MAX(ふるさと納税 計算値 − 2,000円, 0)",
      },
      {
        field: "incomeDeductionTotalForIncomeTax",
        label: "所得控除額合計",
        formula: "社会保険料控除 + 生命保険料控除(所得税) + 基礎控除(所得税) + 寄付金控除(ふるさと納税分)",
      },
      {
        field: "taxableIncomeForIncomeTax",
        label: "課税される所得金額",
        formula: "給与所得額 − 所得控除額合計（1,000円未満切り捨て）",
      },
      {
        field: "incomeTaxRate",
        label: "所得税率",
        formula: "課税される所得金額に応じた所得税の速算表の税率",
        isRate: true,
        renderExtra: (breakdown) => (
          <BracketTable rows={INCOME_TAX_RATE_BRACKETS} activeValue={breakdown.taxableIncomeForIncomeTax.auto} />
        ),
      },
      {
        field: "incomeTaxAmount",
        label: "所得税額",
        formula: "課税される所得金額に所得税の累進税率を適用した金額(速算式)。下表は税率ごとの内訳",
        renderExtra: (breakdown) => (
          <IncomeTaxAmountBreakdown taxableIncome={breakdown.taxableIncomeForIncomeTax.auto} />
        ),
      },
      {
        field: "flatTaxReduction2024",
        label: "定額減税(2024年)",
        formula: "令和6年分のみ実施された定額減税(所得税分)。既定値は0円のため、対象年度のみ手入力してください",
      },
      {
        field: "baseIncomeTaxAmount",
        label: "基準所得税額",
        formula: "所得税額 − 定額減税(2024年)",
      },
      {
        field: "reconstructionSurtax",
        label: "復興特別所得税額",
        formula: "基準所得税額 × 2.1%（1円未満切り捨て）",
      },
      {
        field: "incomeTaxAndSurtaxTotal",
        label: "所得税及び復興特別所得税の額",
        formula: "基準所得税額 + 復興特別所得税額",
      },
      {
        field: "incomeTaxWithheldTotal",
        label: "源泉徴収税額",
        formula: "その年の給与・賞与から天引きされた所得税の合計(自動集計)",
      },
      {
        field: "taxReturnPayment",
        label: "申告納税額",
        formula: "所得税及び復興特別所得税の額 − 源泉徴収税額（マイナスの場合は還付）",
      },
    ],
  },
  {
    title: "住民税",
    fields: [
      {
        field: "lifeInsuranceGeneralDeductionResidentTax",
        label: "一般生命保険料(控除額)",
        formula: "一般生命保険料(支払額)から算出した住民税の控除額(速算表)",
        renderExtra: (_breakdown, amounts) => (
          <LifeInsuranceDeductionTable
            rows={LIFE_INSURANCE_RESIDENT_TAX_ROWS}
            premium={amounts.lifeInsuranceGeneral ?? 0}
          />
        ),
      },
      {
        field: "lifeInsuranceCareMedicalDeductionResidentTax",
        label: "介護医療保険料(控除額)",
        formula: "介護医療保険料(支払額)から算出した住民税の控除額(一般生命保険料と同じ速算表)",
        renderExtra: (_breakdown, amounts) => (
          <LifeInsuranceDeductionTable
            rows={LIFE_INSURANCE_RESIDENT_TAX_ROWS}
            premium={amounts.lifeInsuranceCareMedical ?? 0}
          />
        ),
      },
      {
        field: "lifeInsurancePensionDeductionResidentTax",
        label: "個人年金保険料(控除額)",
        formula: "個人年金保険料(支払額)から算出した住民税の控除額(一般生命保険料と同じ速算表)",
        renderExtra: (_breakdown, amounts) => (
          <LifeInsuranceDeductionTable
            rows={LIFE_INSURANCE_RESIDENT_TAX_ROWS}
            premium={amounts.lifeInsurancePension ?? 0}
          />
        ),
      },
      {
        field: "lifeInsuranceForResidentTax",
        label: "生命保険料控除",
        formula: "一般 + 介護医療 + 個人年金の各控除額(住民税用)の合計",
      },
      {
        field: "basicDeductionForResidentTax",
        label: "基礎控除",
        formula: "給与所得額に応じた住民税の基礎控除額の速算表",
        renderExtra: (breakdown) => (
          <BracketTable
            rows={BASIC_DEDUCTION_RESIDENT_TAX_BRACKETS}
            activeValue={breakdown.employmentIncome.auto}
          />
        ),
      },
      {
        field: "incomeDeductionTotalForResidentTax",
        label: "所得控除合計",
        formula: "社会保険料控除 + 生命保険料控除(住民税) + 基礎控除(住民税)",
      },
      {
        field: "taxableIncomeForResidentTax",
        label: "課税所得金額",
        formula: "給与所得額 − 所得控除合計（1,000円未満切り捨て）",
      },
      {
        field: "residentTaxRateCity",
        label: "市民税所得割率",
        formula: "市民税の所得割率(標準税率6%)",
        isRate: true,
      },
      {
        field: "residentTaxRatePrefecture",
        label: "県民税所得割率",
        formula: "県民税の所得割率(標準税率4%)",
        isRate: true,
      },
      {
        field: "incomeLeviedCity",
        label: "(市民)税額控除前所得割額",
        formula: "課税所得金額 × 市民税所得割率",
      },
      {
        field: "incomeLeviedPrefecture",
        label: "(県民)税額控除前所得割額",
        formula: "課税所得金額 × 県民税所得割率",
      },
      {
        field: "totalIncomeLevied",
        label: "税額控除前所得割額",
        formula: "(市民)+(県民)税額控除前所得割額の合計",
      },
      {
        field: "adjustmentDeductionCity",
        label: "(市民)調整控除",
        formula: "市民税の調整控除(定額1,500円)",
      },
      {
        field: "adjustmentDeductionPrefecture",
        label: "(県民)調整控除",
        formula: "県民税の調整控除(定額1,000円)",
      },
      {
        field: "adjustmentDeductionTotal",
        label: "調整控除",
        formula: "(市民)+(県民)調整控除の合計",
      },
      {
        field: "incomeLeviedAfterAdjustment",
        label: "調整控除後の所得割額",
        formula: "税額控除前所得割額 − 調整控除",
      },
      {
        field: "incomeLeviedAfterAdjustmentTimes02",
        label: "調整控除後の所得割額×0.2",
        formula: "調整控除後の所得割額 × 20%（ふるさと納税の特例控除の上限計算に使用）",
      },
      {
        field: "furusatoNozeiLimit",
        label: "(参考)ふるさと納税上限",
        formula:
          "調整控除後の所得割額×0.2 ÷ (1 − 10% − 所得税率×1.021) + 2,000円。参考値のため他の項目には影響しません",
      },
      {
        field: "donationBase",
        label: "寄付金-2000円",
        formula: "MAX(ふるさと納税 計算値 − 2,000円, 0)",
      },
      {
        field: "donationCreditBasic",
        label: "寄付金税額控除(基本分)",
        formula: "寄付金-2000円 × 10%",
      },
      {
        field: "donationCreditSpecial",
        label: "寄付金税額控除(特例分)",
        formula: "MIN(調整控除後の所得割額×0.2, 寄付金-2000円 × (1 − 10% − 所得税率×1.021))",
      },
      {
        field: "donationCreditCity",
        label: "(市民)寄付金税額控除",
        formula: "(基本分+特例分) × 市民税率 ÷ (市民税率+県民税率)（1円未満切り上げ）",
      },
      {
        field: "donationCreditPrefecture",
        label: "(県民)寄付金税額控除",
        formula: "(基本分+特例分) × 県民税率 ÷ (市民税率+県民税率)（1円未満切り上げ）",
      },
      {
        field: "taxCreditCity",
        label: "(市民)税額控除額",
        formula: "(市民)調整控除 + (市民)寄付金税額控除",
      },
      {
        field: "taxCreditPrefecture",
        label: "(県民)税額控除額",
        formula: "(県民)調整控除 + (県民)寄付金税額控除",
      },
      {
        field: "incomeLeviedCityFinal",
        label: "(市民)所得割額",
        formula: "MAX((市民)税額控除前所得割額 − (市民)税額控除額, 0)（100円未満切り捨て）",
      },
      {
        field: "incomeLeviedPrefectureFinal",
        label: "(県民)所得割額",
        formula: "MAX((県民)税額控除前所得割額 − (県民)税額控除額, 0)（100円未満切り捨て）",
      },
      {
        field: "perCapitaLevyCity",
        label: "(市民)均等割額",
        formula: "市民税の均等割(全国標準額 3,000円)",
      },
      {
        field: "perCapitaLevyPrefecture",
        label: "(県民)均等割額",
        formula: "県民税の均等割(全国標準額 1,000円。自治体独自の上乗せがある場合は上書きしてください)",
      },
      {
        field: "forestEnvironmentTax",
        label: "森林環境税",
        formula: "森林環境税(全国一律 1,000円)",
      },
      {
        field: "annualTotal",
        label: "特別徴収税額",
        formula: "(市民)+(県民)所得割額 + (市民)+(県民)均等割額 + 森林環境税",
      },
      {
        field: "juneAmount",
        label: "特別徴収税額(6月分・端数調整)",
        formula: "特別徴収税額 − (7月〜翌年5月分 × 11か月)。端数を6月分にまとめて調整します",
      },
      {
        field: "elevenMonthAmount",
        label: "特別徴収税額(7月〜翌年5月分・各月)",
        formula: "特別徴収税額 ÷ 12（100円未満切り捨て）を7月〜翌年5月の各月分として使用",
      },
    ],
  },
];

// ふるさと納税は寄付明細からの自動集計に置き換わったため、ここには並べない。
// 調整額（Deduction.furusatoNozei）だけを専用の欄で入力する（#174）。
const AMOUNT_INPUT_ROWS: { key: DeductionType; label: string; formula?: string }[] = [
  { key: "lifeInsuranceGeneral", label: "一般生命保険料（年間支払額）" },
  { key: "lifeInsuranceCareMedical", label: "介護医療保険料（年間支払額）" },
  { key: "lifeInsurancePension", label: "個人年金保険料（年間支払額）" },
];

// 「実績データを保存する」で /api/deductions へ送る控除の種類。
// furusatoNozei は明細に載せていない調整額として保存する
const SAVED_DEDUCTION_TYPES: DeductionType[] = [
  ...AMOUNT_INPUT_ROWS.map(({ key }) => key),
  "furusatoNozei",
];

function initialOverrideValues(
  overrides: ResidentTaxOverrides
): Partial<Record<ResidentTaxBreakdownField, number>> {
  const values: Partial<Record<ResidentTaxBreakdownField, number>> = {};
  for (const { fields } of SECTIONS) {
    for (const { field } of fields) {
      if (overrides[field] !== undefined) values[field] = overrides[field];
    }
  }
  return values;
}

function FormulaInfo({ formula, extra }: { formula: string; extra?: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="計算式を表示"
          className="text-muted-foreground hover:text-foreground"
        >
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className={extra ? "w-auto max-w-sm" : undefined}>
        <p className="text-xs leading-relaxed">{formula}</p>
        {extra}
      </PopoverContent>
    </Popover>
  );
}

export function TaxCalculationDetail({
  year,
  amounts,
  overrides,
  isLocked,
  grossIncome,
  socialInsuranceTotal,
  incomeTaxWithheldTotal,
  donationSummary,
  onAmountsChange,
}: {
  year: number;
  amounts: Partial<Record<DeductionType, number>>;
  overrides: ResidentTaxOverrides;
  isLocked: boolean;
  grossIncome: number;
  socialInsuranceTotal: number;
  incomeTaxWithheldTotal: number;
  donationSummary: DonationSummary;
  onAmountsChange?: (amounts: Partial<Record<DeductionType, number>>) => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState(() => initialOverrideValues(overrides));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [amountValues, setAmountValues] = useState(amounts);
  const [isSavingAmounts, setIsSavingAmounts] = useState(false);
  const [isLocking, setIsLocking] = useState(false);

  // 寄付明細が正本。住民税計算に使う額は 明細合計 + 調整額（#174）
  const furusatoAdjustment = amountValues.furusatoNozei ?? 0;
  const furusatoEffectiveTotal = donationSummary.total + furusatoAdjustment;
  const hasDoubleCountRisk = donationSummary.total > 0 && furusatoAdjustment > 0;

  useEffect(() => {
    onAmountsChange?.(amountValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountValues]);

  const breakdown = useMemo(
    () =>
      calculateAnnualResidentTax(
        {
          annualGrossIncome: grossIncome,
          socialInsuranceTotal,
          lifeInsuranceGeneral: amountValues.lifeInsuranceGeneral ?? 0,
          lifeInsuranceCareMedical: amountValues.lifeInsuranceCareMedical ?? 0,
          lifeInsurancePension: amountValues.lifeInsurancePension ?? 0,
          furusatoNozei: furusatoEffectiveTotal,
          incomeTaxWithheldTotal,
        },
        values
      ),
    [
      grossIncome,
      socialInsuranceTotal,
      incomeTaxWithheldTotal,
      amountValues.lifeInsuranceGeneral,
      amountValues.lifeInsuranceCareMedical,
      amountValues.lifeInsurancePension,
      furusatoEffectiveTotal,
      values,
    ]
  );

  function handleChange(field: ResidentTaxBreakdownField, value: number | undefined) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function handleAmountChange(key: DeductionType, value: number | undefined) {
    setAmountValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSaveAmounts() {
    setIsSavingAmounts(true);
    try {
      const result = await saveDeductions({
        year,
        amounts: Object.fromEntries(SAVED_DEDUCTION_TYPES.map((key) => [key, amountValues[key] ?? 0])),
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("実績データを保存しました");
      router.refresh();
    } finally {
      setIsSavingAmounts(false);
    }
  }

  async function handleLock() {
    setIsLocking(true);
    try {
      const result = await lockYear({
        year,
        values: Object.fromEntries(
          RESIDENT_TAX_BREAKDOWN_FIELDS.map((field) => [field, breakdown[field].value])
        ),
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("この年の計算結果を確定しました");
      router.refresh();
    } finally {
      setIsLocking(false);
    }
  }

  async function handleUnlock() {
    setIsLocking(true);
    try {
      const result = await unlockYear(year);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("確定を解除しました");
      router.refresh();
    } finally {
      setIsLocking(false);
    }
  }

  async function handleSave() {
    setIsSubmitting(true);
    try {
      // 値のある項目は保存し、空にした項目は null で上書きを解除する（保存済みの項目だけが対象）
      const changes: Partial<Record<ResidentTaxBreakdownField, number | null>> = {};
      for (const { fields } of SECTIONS) {
        for (const { field } of fields) {
          const value = values[field];
          if (value !== undefined) changes[field] = value;
          else if (overrides[field] !== undefined) changes[field] = null;
        }
      }
      const result = await saveOverrides({ year, values: changes });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("計算過程の上書きを保存しました");
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        各項目は今年の給与・賞与実績から自動計算した推定値です。実際の申告書・課税決定通知書などで異なる金額が判明した場合は、直接入力して上書きできます（下流の項目にも反映されます）。
        扶養親族等の数は0人として計算しています。項目名の隣の <Info className="inline size-3.5 align-text-bottom" /> アイコンをクリックすると計算式を確認できます。
      </p>

      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">確定申告の内容が確定したら</p>
            {isLocked && <Badge variant="secondary">確定済み</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            {isLocked
              ? "この年の計算結果は現在の値で固定されています。将来、計算式を変更しても表示金額は変わりません。"
              : "この年の全項目を今の自動計算値で固定します。将来、計算式を変更しても、この年の表示金額は変わらなくなります。"}
          </p>
        </div>
        {isLocked ? (
          <Button type="button" variant="outline" onClick={handleUnlock} disabled={isLocking}>
            確定を解除する
          </Button>
        ) : (
          <Button type="button" onClick={handleLock} disabled={isLocking}>
            この年を確定する
          </Button>
        )}
      </div>

      <div className="max-w-sm space-y-3 rounded-md border p-3">
        <p className="text-sm font-semibold">共通（入力データ）</p>
        <p className="text-xs text-muted-foreground">
          住民税の自動計算に使用します。給与明細の支給月に応じて、この年のデータから翌年6月〜翌々年5月分の住民税を推定します。
        </p>
        {AMOUNT_INPUT_ROWS.map(({ key, label, formula }) => (
          <div key={key} className="space-y-1.5">
            <div className="flex items-center gap-1">
              <Label htmlFor={`${key}-${year}`}>{label}</Label>
              {formula && <FormulaInfo formula={formula} />}
            </div>
            <AmountInput
              id={`${key}-${year}`}
              value={amountValues[key]}
              onChange={(value) => handleAmountChange(key, value)}
            />
          </div>
        ))}
        <div className="space-y-1.5">
          <Label>ふるさと納税額（年間合計）</Label>
          <div className="flex items-center justify-between gap-2 rounded-md border border-dashed bg-muted px-3 py-2">
            <span className="text-base font-semibold tabular-nums">
              {donationSummary.total.toLocaleString()} 円
            </span>
            <span className="text-xs text-muted-foreground">寄付明細 {donationSummary.donationCount}件</span>
          </div>
          <p className="text-xs text-muted-foreground">
            寄付明細から自動集計しています。金額を直すには<Link href={`/furusato?year=${year}`} className="text-primary underline">ふるさと納税の寄付明細</Link>を編集してください。
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`furusatoNozei-${year}`}>明細に載せていない調整額</Label>
          <AmountInput
            id={`furusatoNozei-${year}`}
            value={amountValues.furusatoNozei}
            onChange={(value) => handleAmountChange("furusatoNozei", value)}
          />
          <p className="text-xs text-muted-foreground">
            移行前に年間合計だけを登録していた分です。明細を登録した年は0にしてください。
          </p>
        </div>

        {hasDoubleCountRisk && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-destructive">
                二重計上になっていないか確認してください
              </p>
              <p className="text-xs">
                {year}年は寄付明細の合計 {donationSummary.total.toLocaleString()}円 と、調整額{" "}
                {furusatoAdjustment.toLocaleString()}円 の両方に金額があります。
                明細に載せた寄付が調整額にも含まれている場合は、調整額から差し引いてください。
              </p>
            </div>
          </div>
        )}

        <div className="flex items-baseline justify-between border-t pt-3">
          <span className="text-sm">住民税計算に使う額</span>
          <span className="text-lg font-semibold tabular-nums">
            {furusatoEffectiveTotal.toLocaleString()} 円
          </span>
        </div>

        <Button type="button" onClick={handleSaveAmounts} disabled={isSavingAmounts}>
          実績データを保存する
        </Button>
      </div>

      {SECTIONS.map(({ title, fields }) => (
        <div key={title} className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-semibold">{title}</p>
          {fields.map(({ field, label, formula, isRate, renderExtra }) => {
            const auto = isRate ? breakdown[field].auto * 100 : breakdown[field].auto;
            const manualValue = isRate
              ? values[field] !== undefined
                ? values[field]! * 100
                : undefined
              : values[field];
            return (
              <div key={field} className="space-y-1.5">
                <div className="flex items-center gap-1">
                  <Label htmlFor={`${field}-${year}`}>
                    {label}
                    {isRate ? "（%）" : ""}
                  </Label>
                  <FormulaInfo formula={formula} extra={renderExtra?.(breakdown, amountValues)} />
                </div>
                <AmountInput
                  id={`${field}-${year}`}
                  placeholder={auto.toLocaleString()}
                  value={manualValue}
                  onChange={(value) =>
                    handleChange(field, value === undefined ? undefined : isRate ? value / 100 : value)
                  }
                />
                <AutoCalcHint manualValue={manualValue} autoValue={auto} unit={isRate ? "%" : "円"} />
              </div>
            );
          })}
        </div>
      ))}

      <Button type="button" onClick={handleSave} disabled={isSubmitting}>
        計算過程の上書きを保存する
      </Button>
    </div>
  );
}
