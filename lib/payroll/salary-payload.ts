// 給与の入力値から、保存する総支給・手取・`data` を組み立てる（Issue #791）。
//
// 給与フォーム（components/payroll/salary-form.tsx）と、代理登録API（lib/payroll/agent-import.ts）が同じ計算を使う。
// 保険料・所得税の自動計算や前回明細の残業額といった「空欄の既定値」は呼び出し側で解決してから渡す。
// ここは足し引きと、控除をマイナスで持つ保存形式への変換だけを担う。
//
// クライアントからも import するため、この lib は `db` に依存させない。
// `node --test` で単体テストするため、import は相対パス・拡張子付きで書く。
import { INCOME_TAX_ADJUSTMENT_ITEM_NAMES } from "./types";
import type { ItemDTO } from "./types";

export type ResolvedSalaryInput = {
  /** yyyy-MM-dd */
  salaryDate: string;
  baseSalary: number;
  overtimeHours: number;
  overtimeAmount: number;
  standardMonthlyRemuneration: number;
  /** 法定控除はフォームの表示と同じく正の値で渡す */
  healthInsurance: number;
  pension: number;
  employmentInsurance: number;
  incomeTax: number;
  residentTax: number;
  /** 項目ごとの金額（フォームの表示どおり。控除系も正の値）。`items` に無い id は無視する */
  customValues: Record<string, number>;
  memo?: string;
};

export type SalaryPayloadItem = Pick<ItemDTO, "id" | "itemName" | "itemType">;

export type SalaryPayload = {
  salaryDate: string;
  grossSalary: number;
  netSalary: number;
  memo?: string;
  data: {
    baseGrossSalary: number;
    overtimeHours: number;
    overtime: number;
    standardMonthlyRemuneration: number;
    healthInsurance: number;
    pension: number;
    employmentInsurance: number;
    incomeTax: number;
    residentTax: number;
    customItemValues: Record<string, number>;
  };
};

// 控除系項目(deduction/statutoryDeduction)は常にマイナスで保存する。
// 年末調整・所得税(差額)項目は控除系でも追加徴収/還付の両方があり得るため、符号を保持する。
function isDeductionLike(item: SalaryPayloadItem): boolean {
  return (
    (item.itemType === "deduction" || item.itemType === "statutoryDeduction") &&
    !INCOME_TAX_ADJUSTMENT_ITEM_NAMES.includes(item.itemName)
  );
}

/** 給与フォームの「支給額」「手取額」と同じ足し引き */
export function computeSalaryTotals(
  input: ResolvedSalaryInput,
  items: SalaryPayloadItem[]
): { grossSalary: number; netSalary: number } {
  const total = (type: SalaryPayloadItem["itemType"]) =>
    items
      .filter((item) => item.itemType === type)
      .reduce((sum, item) => sum + (input.customValues[item.id] || 0), 0);

  const grossSalary = input.baseSalary + input.overtimeAmount + total("earning") + total("otherEarning");
  const netSalary =
    grossSalary -
    input.healthInsurance -
    input.pension -
    input.employmentInsurance -
    input.incomeTax -
    input.residentTax -
    total("statutoryDeduction") -
    total("deduction");
  return { grossSalary, netSalary };
}

/** `createSalaryAction` / `CreateSalarySchema` へそのまま渡せる形にする */
export function buildSalaryPayload(input: ResolvedSalaryInput, items: SalaryPayloadItem[]): SalaryPayload {
  const customItemValues = Object.fromEntries(
    items
      .map((item) => {
        const amount = input.customValues[item.id] || 0;
        return [item.id, isDeductionLike(item) ? -amount : amount] as const;
      })
      .filter(([, amount]) => amount !== 0)
  );

  const { grossSalary, netSalary } = computeSalaryTotals(input, items);
  return {
    // 支給日は日付入力の値を UTC の0時として持つ
    salaryDate: new Date(input.salaryDate).toISOString(),
    grossSalary,
    netSalary,
    memo: input.memo || undefined,
    data: {
      baseGrossSalary: input.baseSalary,
      overtimeHours: input.overtimeHours,
      overtime: input.overtimeAmount,
      standardMonthlyRemuneration: input.standardMonthlyRemuneration,
      healthInsurance: -input.healthInsurance,
      pension: -input.pension,
      employmentInsurance: -input.employmentInsurance,
      incomeTax: -input.incomeTax,
      residentTax: -input.residentTax,
      customItemValues,
    },
  };
}
