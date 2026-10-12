import { resolveCustomItems, toItemMap } from "@/lib/payroll/item-snapshot";

export function calculateOvertime(input: {
  baseSalary: number; // 月給
  overtimeHours: number; // 残業時間
  workingHours?: number; // 所定労働時間（デフォルト: 160）
}): { hourlyRate: number; overtimeAmount: number } {
  const { baseSalary, overtimeHours, workingHours = 160 } = input;
  const hourlyRate = baseSalary / workingHours;
  const overtimeAmount = hourlyRate * overtimeHours;

  return {
    hourlyRate: Math.round(hourlyRate),
    overtimeAmount: Math.round(overtimeAmount * 100) / 100,
  };
}

export function calculateStatutoryInsurance(input: {
  standardAmount: number; // 標準報酬月額（賞与は標準賞与額）。健康保険・厚生年金の算定基礎
  grossPay: number; // 雇用保険の算定基礎（給与はその他支給を含まない、賞与はその他支給を含む）
  healthInsuranceRate?: number; // デフォルト: 9.15
  pensionRate?: number; // デフォルト: 9.15
  employmentInsuranceRate?: number; // デフォルト: 0.60
}): { healthInsurance: number; pension: number; employmentInsurance: number; total: number } {
  const {
    standardAmount,
    grossPay,
    healthInsuranceRate = 9.15,
    pensionRate = 9.15,
    employmentInsuranceRate = 0.6,
  } = input;

  const healthInsurance = Math.round((standardAmount * healthInsuranceRate) / 100);
  const pension = Math.round((standardAmount * pensionRate) / 100);
  const employmentInsurance = Math.round((grossPay * employmentInsuranceRate) / 100);

  return {
    healthInsurance,
    pension,
    employmentInsurance,
    total: healthInsurance + pension + employmentInsurance,
  };
}

export function calculateStandardBonusAmount(grossPay: number): number {
  return Math.floor(grossPay / 1000) * 1000;
}

// 国税庁「給与所得の源泉徴収税額の電算機計算の特例」（令和7年分以降・甲欄・扶養親族等の数=0人）を実装。
// 給与所得控除額・基礎控除額とも月額換算の区分式で、扶養親族等がいる場合は追加控除が必要（本実装は非対応）。
function calculateMonthlyEmploymentIncomeDeduction(taxableBase: number): number {
  if (taxableBase < 158334) return 54167;
  if (taxableBase < 300000) return Math.ceil(taxableBase * 0.3 + 6667);
  if (taxableBase < 550000) return Math.ceil(taxableBase * 0.2 + 36667);
  if (taxableBase < 708331) return Math.ceil(taxableBase * 0.1 + 91667);
  return 162500;
}

function calculateMonthlyBasicDeduction(taxableBase: number): number {
  if (taxableBase < 2120834) return 48334;
  if (taxableBase < 2162500) return 40000;
  if (taxableBase < 2204117) return 26667;
  if (taxableBase < 2245834) return 13334;
  return 0;
}

function calculateWithholdingTaxFromTaxableIncome(taxableIncome: number): number {
  let tax: number;
  if (taxableIncome < 162501) tax = taxableIncome * 0.05105;
  else if (taxableIncome < 275001) tax = taxableIncome * 0.1021 - 8296;
  else if (taxableIncome < 579167) tax = taxableIncome * 0.2042 - 36374;
  else if (taxableIncome < 750001) tax = taxableIncome * 0.23483 - 54113;
  else if (taxableIncome < 1500001) tax = taxableIncome * 0.33693 - 130688;
  else if (taxableIncome < 3333334) tax = taxableIncome * 0.4084 - 237893;
  else tax = taxableIncome * 0.45945 - 408061;
  return Math.round(tax / 10) * 10;
}

export function calculateWithholdingIncomeTax(taxableBase: number): number {
  const base = Math.max(taxableBase, 0);
  const employmentIncomeDeduction = calculateMonthlyEmploymentIncomeDeduction(base);
  const basicDeduction = calculateMonthlyBasicDeduction(base);
  const taxableIncome = Math.max(base - employmentIncomeDeduction - basicDeduction, 0);
  if (taxableIncome === 0) return 0;
  return Math.max(calculateWithholdingTaxFromTaxableIncome(taxableIncome), 0);
}

// 国税庁「賞与に対する源泉徴収税額の算出率の表」（令和7年分・甲欄・扶養親族等の数=0人）を実装。
// 前月の給与がない場合、前月の給与が社会保険料等以下の場合、賞与が前月給与(社会保険料等控除後)の
// 10倍を超える場合は月額表を使った特例計算になるが、本実装は非対応。
function calculateBonusWithholdingRate(previousMonthTaxableSalary: number): number {
  const base = Math.max(previousMonthTaxableSalary, 0);
  const brackets: [number, number][] = [
    [68000, 0.02042],
    [79000, 0.04084],
    [252000, 0.06126],
    [300000, 0.08168],
    [334000, 0.1021],
    [363000, 0.12252],
    [395000, 0.14294],
    [426000, 0.16336],
    [520000, 0.18378],
    [601000, 0.2042],
    [678000, 0.22462],
    [708000, 0.24504],
    [745000, 0.26546],
    [788000, 0.28588],
    [846000, 0.3063],
    [914000, 0.32672],
    [1312000, 0.35735],
    [1521000, 0.38798],
    [2621000, 0.41861],
    [3495000, 0.45945],
  ];
  if (base < brackets[0][0]) return 0;
  for (let i = 1; i < brackets.length; i++) {
    if (base < brackets[i][0]) return brackets[i - 1][1];
  }
  return brackets[brackets.length - 1][1];
}

export function calculateBonusWithholdingTax(
  previousMonthTaxableSalary: number,
  bonusTaxableBase: number
): number {
  const rate = calculateBonusWithholdingRate(previousMonthTaxableSalary);
  return Math.floor(Math.max(bonusTaxableBase, 0) * rate);
}

// 賞与の所得税自動計算に使う「前月の社会保険料等控除後の給与等の金額」を、
// 保存済みの給与レコード（支給額・控除額・非課税支給項目）から算出する。
export function calculatePreviousMonthTaxableSalary(
  salary: { grossSalary: number; data: Record<string, unknown> },
  items: { id: string; itemName: string; itemType: string; isTaxable: boolean }[]
): number {
  const data = salary.data;
  const numAbs = (key: string) => {
    const value = data[key];
    return typeof value === "number" ? Math.abs(value) : 0;
  };
  // 非課税支給・その他(課税処理)の判定は、その給与を保存した時点の項目定義（data.itemSnapshots）を優先する（#212）
  const customItems = resolveCustomItems(data, toItemMap(items));
  const nonTaxableEarningTotal = customItems
    .filter(
      ({ definition }) =>
        (definition.itemType === "earning" || definition.itemType === "otherEarning") &&
        !definition.isTaxable
    )
    .reduce((sum, { value }) => sum + Math.abs(value), 0);
  const otherTaxableTotal = customItems
    .filter(({ definition }) => definition.itemType === "otherTaxable")
    .reduce((sum, { value }) => sum + Math.abs(value), 0);

  return (
    salary.grossSalary -
    numAbs("healthInsurance") -
    numAbs("pension") -
    numAbs("employmentInsurance") -
    nonTaxableEarningTotal +
    otherTaxableTotal
  );
}

/**
 * 手入力欄が空（undefined）または NaN なら自動計算の値を使う。
 * react-hook-form の `valueAsNumber` は空欄を undefined ではなく NaN にするため、`value ?? fallback` では足りない。
 */
export function resolveManualNumber(value: number | undefined, fallback: number): number {
  return value === undefined || Number.isNaN(value) ? fallback : value;
}
