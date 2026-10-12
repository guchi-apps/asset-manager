// 給与・賞与の明細行から、確定申告・ふるさと納税上限額の見込みに使う年間の集計値を出す純粋な計算。
// DB から明細を読む処理は `annualTaxData.ts` に残し、ここは `db` に依存させない
// （単体テストを DB なしで実行できるようにするため。相対 import は `node --test` で直接読み込めるようにするため）。
import { INCOME_TAX_ADJUSTMENT_ITEM_NAMES } from "./annual-tax";
import { resolveCustomItems, type ItemDefinition } from "../payroll/item-snapshot";

function sumAbsField(data: unknown, field: string): number {
  const d = (data ?? {}) as Record<string, unknown>;
  const value = d[field];
  return typeof value === "number" ? Math.abs(value) : 0;
}

function numberField(data: unknown, field: string): number {
  const d = (data ?? {}) as Record<string, unknown>;
  const value = d[field];
  return typeof value === "number" ? value : 0;
}

function insuranceFromData(data: unknown): number {
  return (
    sumAbsField(data, "healthInsurance") +
    sumAbsField(data, "pension") +
    sumAbsField(data, "employmentInsurance")
  );
}

// 項目の定義は、明細に保存した写し（data.itemSnapshots）→ 現在の項目マスタ の順で解決する（#212）。
// 現在のマスタだけを見ると、項目の課税区分・名前・種別を後から変えたときに過去年の集計まで変わってしまう。
export type CurrentItems = ReadonlyMap<string, ItemDefinition>;

// 通勤手当など、支給額(grossSalary/amount)には含まれるが所得税・住民税の課税対象にはならない項目の金額を合計する
function nonTaxableEarningFromData(data: unknown, currentItems: CurrentItems): number {
  return resolveCustomItems(data, currentItems)
    .filter(
      ({ definition }) =>
        (definition.itemType === "earning" || definition.itemType === "otherEarning") &&
        !definition.isTaxable
    )
    .reduce((sum, { value }) => sum + Math.abs(value), 0);
}

// 年末調整・所得税(差額)項目の金額（追加徴収ならマイナス、還付ならプラスで保存されている）を合計する
function incomeTaxAdjustmentFromData(data: unknown, currentItems: CurrentItems): number {
  return resolveCustomItems(data, currentItems)
    .filter(({ definition }) => INCOME_TAX_ADJUSTMENT_ITEM_NAMES.includes(definition.itemName))
    .reduce((sum, { value }) => sum + value, 0);
}

// grossSalary / amount は Prisma の Decimal のまま渡されるため `unknown`（`Number()` で数値化する）
export type SalaryRow = { salaryDate: Date; grossSalary: unknown; data: unknown };
export type BonusRow = { bonusDate: Date; amount: unknown; data: unknown };

export type AnnualAggregate = {
  grossIncome: number;
  socialInsuranceTotal: number;
  incomeTaxWithheldTotal: number;
  salaryCount: number;
  bonusCount: number;
};

export function computeAnnualAggregate(
  salaries: Pick<SalaryRow, "grossSalary" | "data">[],
  bonuses: Pick<BonusRow, "amount" | "data">[],
  currentItems: CurrentItems
): AnnualAggregate {
  // 通勤手当など非課税支給項目は支給額(grossSalary/amount)に含まれるが、
  // 確定申告の「給与」(収入金額)には含めない
  const nonTaxableEarningTotal =
    salaries.reduce((sum, r) => sum + nonTaxableEarningFromData(r.data, currentItems), 0) +
    bonuses.reduce((sum, r) => sum + nonTaxableEarningFromData(r.data, currentItems), 0);

  const grossIncome =
    salaries.reduce((sum, r) => sum + Number(r.grossSalary), 0) +
    bonuses.reduce((sum, r) => sum + Number(r.amount), 0) -
    nonTaxableEarningTotal;
  const socialInsuranceTotal =
    salaries.reduce((sum, r) => sum + insuranceFromData(r.data), 0) +
    bonuses.reduce((sum, r) => sum + insuranceFromData(r.data), 0);

  // 年末調整・賞与の所得税(差額)を項目として手入力している場合、源泉徴収税額の集計から差し引く
  // （追加徴収ならマイナス、還付ならプラスで保存されているため、差し引くことで実際の源泉徴収額に一致する）
  const incomeTaxAdjustmentTotal = [...salaries, ...bonuses].reduce(
    (sum, r) => sum + incomeTaxAdjustmentFromData(r.data, currentItems),
    0
  );
  const incomeTaxWithheldTotal =
    salaries.reduce((sum, r) => sum + sumAbsField(r.data, "incomeTax"), 0) +
    bonuses.reduce((sum, r) => sum + sumAbsField(r.data, "incomeTax"), 0) -
    incomeTaxAdjustmentTotal;

  return {
    grossIncome,
    socialInsuranceTotal,
    incomeTaxWithheldTotal,
    salaryCount: salaries.length,
    bonusCount: bonuses.length,
  };
}

// ふるさと納税の残り枠カードで「どこまでが実績で、どこからが見込みか」を画面に出すための内訳。
export type FurusatoNozeiIncomeProjection = {
  estimatedGrossIncome: number;
  estimatedSocialInsuranceTotal: number;
  // 見込みを含まない、登録済みの実績だけの合計
  actualGrossIncome: number;
  actualSocialInsuranceTotal: number;
  registeredSalaryMonths: number[];
  missingSalaryMonths: number[];
  projectedSalaryMonthCount: number;
  registeredBonusMonths: number[];
  projectedBonusMonths: number[];
  projectedBonusTotal: number;
};

// ふるさと納税上限額の見込み計算用に、その年の残り月分の給与・賞与を推定する。
// - 給与: 直近の給与明細と同じ基本給(baseGrossSalary)の月だけを対象に平均し、未登録の残り月数分を加算する
//   （昇給があった場合、昇給前の月を平均に混ぜないようにするため）
// - 賞与: 前年に支給があった月のうち、その年にまだ登録がない月については前年同月の支給額を見込みとして加算する
// `salaries` は支給日の昇順で渡すこと（最後の要素を「直近の給与明細」として扱う）。
export function computeFurusatoNozeiIncomeProjection(
  salaries: SalaryRow[],
  bonuses: BonusRow[],
  prevBonuses: BonusRow[],
  currentItems: CurrentItems
): FurusatoNozeiIncomeProjection {
  // 通勤手当など非課税支給項目は支給額(grossSalary/amount)に含まれるが、収入金額の見込みには含めない
  const taxableGross = (grossSalary: number, data: unknown) =>
    grossSalary - nonTaxableEarningFromData(data, currentItems);

  const actualSalaryGross = salaries.reduce((sum, s) => sum + taxableGross(Number(s.grossSalary), s.data), 0);
  const actualSalaryInsurance = salaries.reduce((sum, s) => sum + insuranceFromData(s.data), 0);
  let estimatedSalaryGross = actualSalaryGross;
  let estimatedSalaryInsurance = actualSalaryInsurance;

  const registeredSalaryMonths = Array.from(
    new Set(salaries.map((s) => s.salaryDate.getMonth() + 1))
  ).sort((a, b) => a - b);
  const missingSalaryMonths = Array.from({ length: 12 }, (_, i) => i + 1).filter(
    (month) => !registeredSalaryMonths.includes(month)
  );

  const remainingMonths = Math.max(12 - salaries.length, 0);
  if (remainingMonths > 0 && salaries.length > 0) {
    const currentBaseSalary = numberField(salaries[salaries.length - 1].data, "baseGrossSalary");
    const currentRegime = salaries.filter(
      (s) => numberField(s.data, "baseGrossSalary") === currentBaseSalary
    );
    const avgGross =
      currentRegime.reduce((sum, s) => sum + taxableGross(Number(s.grossSalary), s.data), 0) /
      currentRegime.length;
    const avgInsurance =
      currentRegime.reduce((sum, s) => sum + insuranceFromData(s.data), 0) / currentRegime.length;

    estimatedSalaryGross += avgGross * remainingMonths;
    estimatedSalaryInsurance += avgInsurance * remainingMonths;
  }

  const enteredBonusMonths = new Set(bonuses.map((b) => b.bonusDate.getMonth() + 1));
  const actualBonusGross = bonuses.reduce((sum, b) => sum + taxableGross(Number(b.amount), b.data), 0);
  const actualBonusInsurance = bonuses.reduce((sum, b) => sum + insuranceFromData(b.data), 0);
  let estimatedBonusGross = actualBonusGross;
  let estimatedBonusInsurance = actualBonusInsurance;

  const projectedBonusMonths: number[] = [];
  let projectedBonusTotal = 0;
  for (const prevBonus of prevBonuses) {
    if (enteredBonusMonths.has(prevBonus.bonusDate.getMonth() + 1)) continue;
    const gross = taxableGross(Number(prevBonus.amount), prevBonus.data);
    estimatedBonusGross += gross;
    estimatedBonusInsurance += insuranceFromData(prevBonus.data);
    projectedBonusMonths.push(prevBonus.bonusDate.getMonth() + 1);
    projectedBonusTotal += gross;
  }

  return {
    estimatedGrossIncome: Math.round(estimatedSalaryGross + estimatedBonusGross),
    estimatedSocialInsuranceTotal: Math.round(estimatedSalaryInsurance + estimatedBonusInsurance),
    actualGrossIncome: Math.round(actualSalaryGross + actualBonusGross),
    actualSocialInsuranceTotal: Math.round(actualSalaryInsurance + actualBonusInsurance),
    registeredSalaryMonths,
    missingSalaryMonths,
    projectedSalaryMonthCount: remainingMonths > 0 && salaries.length > 0 ? remainingMonths : 0,
    registeredBonusMonths: Array.from(enteredBonusMonths).sort((a, b) => a - b),
    projectedBonusMonths: projectedBonusMonths.sort((a, b) => a - b),
    projectedBonusTotal: Math.round(projectedBonusTotal),
  };
}
