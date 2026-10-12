// 年次データ（前年の給与・賞与合計、生命保険料支払額、ふるさと納税額）から所得税の確定申告額・住民税の月割額を推定する。
// ユーザーの Excel シート（資産管理.xlsx「税金計算」シート）の数式を再現したもので、以下を前提とした簡略化：
// - 扶養親族等の数=0人（配偶者控除・扶養控除は考慮しない）
// - 生命保険料控除は各保険種別ごとの上限のみ考慮し、3種合計の上限（実務上は住民税7万円・所得税12万円）は課さない
// - 均等割・森林環境税は全国標準額（市区町村独自の上乗せは非対応）
// - 給与所得控除・基礎控除は令和7年分以降の税制（スライド式改正後）の数式を固定で使用する
//   （年度によって税制が異なる場合は、下記の `overrides` で該当項目を実際の金額に上書きする）
//
// 計算過程の各ステップは実際の申告書・課税決定通知書の金額で上書きできるようにしており（`overrides`）、
// 上書きした値は下流のステップにも反映される（例: 給与所得を上書きすると基礎控除以降も再計算される）。

// 年末調整・賞与の所得税(差額)項目は、他の控除項目と異なり追加徴収(マイナス)・還付(プラス)の
// どちらもあり得るため、フォーム入力・保存時に符号を保持する必要がある特別な項目として扱う。
export const INCOME_TAX_ADJUSTMENT_ITEM_NAMES = ["年末調整", "所得税(差額)"];

export function getResidentTaxAssessmentYear(salaryDate: Date): number {
  const month = salaryDate.getMonth() + 1;
  const year = salaryDate.getFullYear();
  return month <= 5 ? year - 2 : year - 1;
}

export function calculateAnnualEmploymentIncome(annualGrossIncome: number): number {
  const x = annualGrossIncome;
  if (x < 1900000) return x - 650000;
  if (x < 3600000) return Math.floor(x / 4000) * 4000 * 0.7 - 80000;
  if (x < 6600000) return Math.floor(x / 4000) * 4000 * 0.8 - 440000;
  if (x < 8500000) return Math.floor(x / 4000) * 4000 * 0.9 - 1100000;
  return x - 1950000;
}

function calculateLifeInsuranceDeduction(
  premium: number,
  thresholds: { first: number; second: number; third: number }
): number {
  const { first, second, third } = thresholds;
  let deduction = premium;
  if (premium > first) deduction -= (premium - first) / 2;
  if (premium > second) deduction -= (premium - second) / 4;
  if (premium > third) deduction -= (premium - third) / 4;
  return Math.max(deduction, 0);
}

const LIFE_INSURANCE_THRESHOLDS_INCOME_TAX = { first: 20000, second: 40000, third: 80000 };
const LIFE_INSURANCE_THRESHOLDS_RESIDENT_TAX = { first: 12000, second: 32000, third: 56000 };

export function calculateBasicDeductionForIncomeTax(employmentIncome: number): number {
  const x = employmentIncome;
  if (x <= 1320000) return 950000;
  if (x <= 3360000) return 880000;
  if (x <= 4890000) return 680000;
  if (x <= 6550000) return 630000;
  if (x <= 23500000) return 580000;
  if (x <= 24000000) return 480000;
  if (x <= 24500000) return 320000;
  if (x <= 25000000) return 160000;
  return 0;
}

export function calculateBasicDeductionForResidentTax(employmentIncome: number): number {
  const x = employmentIncome;
  if (x <= 24000000) return 430000;
  if (x <= 24500000) return 290000;
  if (x <= 25000000) return 150000;
  return 0;
}

export function calculateIncomeTaxRate(taxableIncomeForIncomeTax: number): number {
  const x = taxableIncomeForIncomeTax;
  if (x <= 1950000) return 0.05;
  if (x <= 3300000) return 0.1;
  if (x <= 6950000) return 0.2;
  if (x <= 9000000) return 0.23;
  if (x <= 18000000) return 0.33;
  if (x <= 40000000) return 0.4;
  return 0.45;
}

export function calculateIncomeTaxAmount(taxableIncomeForIncomeTax: number): number {
  const x = taxableIncomeForIncomeTax;
  let tax = x * 0.05;
  if (x > 1950000) tax += (x - 1950000) * 0.05;
  if (x > 3300000) tax += (x - 3300000) * 0.1;
  if (x > 6950000) tax += (x - 6950000) * 0.03;
  if (x > 9000000) tax += (x - 9000000) * 0.1;
  if (x > 18000000) tax += (x - 18000000) * 0.07;
  if (x > 40000000) tax += (x - 40000000) * 0.05;
  return tax;
}

const RESIDENT_TAX_RATE_CITY = 0.06;
const RESIDENT_TAX_RATE_PREFECTURE = 0.04;
const ADJUSTMENT_DEDUCTION_CITY = 1500;
const ADJUSTMENT_DEDUCTION_PREFECTURE = 1000;
// 全国標準額。自治体独自の上乗せ課税（水源環境保全税等）がある場合は実際の金額と差異が出る
const PER_CAPITA_LEVY_CITY = 3000;
const PER_CAPITA_LEVY_PREFECTURE = 1000;
const FOREST_ENVIRONMENT_TAX = 1000;

// 資産管理.xlsx「税金計算」シートB列と同じ項目・並び順
export const RESIDENT_TAX_BREAKDOWN_FIELDS = [
  // 共通
  "annualGrossIncome",
  "employmentIncome",
  "socialInsuranceTotal",
  "furusatoNozeiEffective",
  // 所得税
  "lifeInsuranceGeneralDeductionIncomeTax",
  "lifeInsuranceCareMedicalDeductionIncomeTax",
  "lifeInsurancePensionDeductionIncomeTax",
  "lifeInsuranceForIncomeTax",
  "basicDeductionForIncomeTax",
  "furusatoDeductionForIncomeTax",
  "incomeDeductionTotalForIncomeTax",
  "taxableIncomeForIncomeTax",
  "incomeTaxRate",
  "incomeTaxAmount",
  "flatTaxReduction2024",
  "baseIncomeTaxAmount",
  "reconstructionSurtax",
  "incomeTaxAndSurtaxTotal",
  "incomeTaxWithheldTotal",
  "taxReturnPayment",
  // 住民税
  "lifeInsuranceGeneralDeductionResidentTax",
  "lifeInsuranceCareMedicalDeductionResidentTax",
  "lifeInsurancePensionDeductionResidentTax",
  "lifeInsuranceForResidentTax",
  "basicDeductionForResidentTax",
  "incomeDeductionTotalForResidentTax",
  "taxableIncomeForResidentTax",
  "residentTaxRateCity",
  "residentTaxRatePrefecture",
  "incomeLeviedCity",
  "incomeLeviedPrefecture",
  "totalIncomeLevied",
  "adjustmentDeductionCity",
  "adjustmentDeductionPrefecture",
  "adjustmentDeductionTotal",
  "incomeLeviedAfterAdjustment",
  "incomeLeviedAfterAdjustmentTimes02",
  "furusatoNozeiLimit",
  "donationBase",
  "donationCreditBasic",
  "donationCreditSpecial",
  "donationCreditCity",
  "donationCreditPrefecture",
  "taxCreditCity",
  "taxCreditPrefecture",
  "incomeLeviedCityFinal",
  "incomeLeviedPrefectureFinal",
  "perCapitaLevyCity",
  "perCapitaLevyPrefecture",
  "forestEnvironmentTax",
  "annualTotal",
  "elevenMonthAmount",
  "juneAmount",
] as const;

export type ResidentTaxBreakdownField = (typeof RESIDENT_TAX_BREAKDOWN_FIELDS)[number];

export type ResidentTaxOverrides = Partial<Record<ResidentTaxBreakdownField, number>>;

export type BreakdownValue = { auto: number; value: number };

export type AnnualResidentTaxBreakdown = Record<ResidentTaxBreakdownField, BreakdownValue>;

export function calculateAnnualResidentTax(
  input: {
    annualGrossIncome: number;
    socialInsuranceTotal: number;
    lifeInsuranceGeneral: number;
    lifeInsuranceCareMedical: number;
    lifeInsurancePension: number;
    furusatoNozei: number;
    incomeTaxWithheldTotal: number;
  },
  overrides: ResidentTaxOverrides = {}
): AnnualResidentTaxBreakdown {
  function resolve(field: ResidentTaxBreakdownField, auto: number): BreakdownValue {
    const override = overrides[field];
    const value = typeof override === "number" && !Number.isNaN(override) ? override : auto;
    return { auto, value };
  }

  // --- 共通 ---
  const annualGrossIncome = resolve("annualGrossIncome", input.annualGrossIncome);
  const employmentIncome = resolve(
    "employmentIncome",
    calculateAnnualEmploymentIncome(annualGrossIncome.value)
  );
  const socialInsuranceTotal = resolve("socialInsuranceTotal", input.socialInsuranceTotal);
  const furusatoNozeiEffective = resolve("furusatoNozeiEffective", input.furusatoNozei);

  // --- 所得税 ---
  const lifeInsuranceGeneralDeductionIncomeTax = resolve(
    "lifeInsuranceGeneralDeductionIncomeTax",
    calculateLifeInsuranceDeduction(input.lifeInsuranceGeneral, LIFE_INSURANCE_THRESHOLDS_INCOME_TAX)
  );
  const lifeInsuranceCareMedicalDeductionIncomeTax = resolve(
    "lifeInsuranceCareMedicalDeductionIncomeTax",
    calculateLifeInsuranceDeduction(input.lifeInsuranceCareMedical, LIFE_INSURANCE_THRESHOLDS_INCOME_TAX)
  );
  const lifeInsurancePensionDeductionIncomeTax = resolve(
    "lifeInsurancePensionDeductionIncomeTax",
    calculateLifeInsuranceDeduction(input.lifeInsurancePension, LIFE_INSURANCE_THRESHOLDS_INCOME_TAX)
  );
  const lifeInsuranceForIncomeTax = resolve(
    "lifeInsuranceForIncomeTax",
    lifeInsuranceGeneralDeductionIncomeTax.value +
      lifeInsuranceCareMedicalDeductionIncomeTax.value +
      lifeInsurancePensionDeductionIncomeTax.value
  );
  const basicDeductionForIncomeTax = resolve(
    "basicDeductionForIncomeTax",
    calculateBasicDeductionForIncomeTax(employmentIncome.value)
  );
  const furusatoDeductionForIncomeTax = resolve(
    "furusatoDeductionForIncomeTax",
    Math.max(furusatoNozeiEffective.value - 2000, 0)
  );
  const incomeDeductionTotalForIncomeTax = resolve(
    "incomeDeductionTotalForIncomeTax",
    socialInsuranceTotal.value +
      lifeInsuranceForIncomeTax.value +
      basicDeductionForIncomeTax.value +
      furusatoDeductionForIncomeTax.value
  );
  const taxableIncomeForIncomeTax = resolve(
    "taxableIncomeForIncomeTax",
    Math.floor(
      Math.max(employmentIncome.value - incomeDeductionTotalForIncomeTax.value, 0) / 1000
    ) * 1000
  );
  const incomeTaxRate = resolve(
    "incomeTaxRate",
    calculateIncomeTaxRate(taxableIncomeForIncomeTax.value)
  );
  const incomeTaxAmount = resolve(
    "incomeTaxAmount",
    calculateIncomeTaxAmount(taxableIncomeForIncomeTax.value)
  );
  // 令和6年分のみ実施された一時的な制度のため、既定値は0円（対象年度のみ上書きで入力する）
  const flatTaxReduction2024 = resolve("flatTaxReduction2024", 0);
  const baseIncomeTaxAmount = resolve(
    "baseIncomeTaxAmount",
    incomeTaxAmount.value - flatTaxReduction2024.value
  );
  const reconstructionSurtax = resolve(
    "reconstructionSurtax",
    Math.floor(baseIncomeTaxAmount.value * 0.021)
  );
  const incomeTaxAndSurtaxTotal = resolve(
    "incomeTaxAndSurtaxTotal",
    baseIncomeTaxAmount.value + reconstructionSurtax.value
  );
  const incomeTaxWithheldTotal = resolve("incomeTaxWithheldTotal", input.incomeTaxWithheldTotal);
  const taxReturnPayment = resolve(
    "taxReturnPayment",
    incomeTaxAndSurtaxTotal.value - incomeTaxWithheldTotal.value
  );

  // --- 住民税 ---
  const lifeInsuranceGeneralDeductionResidentTax = resolve(
    "lifeInsuranceGeneralDeductionResidentTax",
    calculateLifeInsuranceDeduction(input.lifeInsuranceGeneral, LIFE_INSURANCE_THRESHOLDS_RESIDENT_TAX)
  );
  const lifeInsuranceCareMedicalDeductionResidentTax = resolve(
    "lifeInsuranceCareMedicalDeductionResidentTax",
    calculateLifeInsuranceDeduction(input.lifeInsuranceCareMedical, LIFE_INSURANCE_THRESHOLDS_RESIDENT_TAX)
  );
  const lifeInsurancePensionDeductionResidentTax = resolve(
    "lifeInsurancePensionDeductionResidentTax",
    calculateLifeInsuranceDeduction(input.lifeInsurancePension, LIFE_INSURANCE_THRESHOLDS_RESIDENT_TAX)
  );
  const lifeInsuranceForResidentTax = resolve(
    "lifeInsuranceForResidentTax",
    lifeInsuranceGeneralDeductionResidentTax.value +
      lifeInsuranceCareMedicalDeductionResidentTax.value +
      lifeInsurancePensionDeductionResidentTax.value
  );
  const basicDeductionForResidentTax = resolve(
    "basicDeductionForResidentTax",
    calculateBasicDeductionForResidentTax(employmentIncome.value)
  );
  const incomeDeductionTotalForResidentTax = resolve(
    "incomeDeductionTotalForResidentTax",
    socialInsuranceTotal.value + lifeInsuranceForResidentTax.value + basicDeductionForResidentTax.value
  );
  const taxableIncomeForResidentTax = resolve(
    "taxableIncomeForResidentTax",
    Math.floor(
      Math.max(employmentIncome.value - incomeDeductionTotalForResidentTax.value, 0) / 1000
    ) * 1000
  );
  const residentTaxRateCity = resolve("residentTaxRateCity", RESIDENT_TAX_RATE_CITY);
  const residentTaxRatePrefecture = resolve("residentTaxRatePrefecture", RESIDENT_TAX_RATE_PREFECTURE);

  const incomeLeviedCity = resolve(
    "incomeLeviedCity",
    taxableIncomeForResidentTax.value * residentTaxRateCity.value
  );
  const incomeLeviedPrefecture = resolve(
    "incomeLeviedPrefecture",
    taxableIncomeForResidentTax.value * residentTaxRatePrefecture.value
  );
  const totalIncomeLevied = resolve(
    "totalIncomeLevied",
    incomeLeviedCity.value + incomeLeviedPrefecture.value
  );
  const adjustmentDeductionCity = resolve("adjustmentDeductionCity", ADJUSTMENT_DEDUCTION_CITY);
  const adjustmentDeductionPrefecture = resolve(
    "adjustmentDeductionPrefecture",
    ADJUSTMENT_DEDUCTION_PREFECTURE
  );
  const adjustmentDeductionTotal = resolve(
    "adjustmentDeductionTotal",
    adjustmentDeductionCity.value + adjustmentDeductionPrefecture.value
  );
  const incomeLeviedAfterAdjustment = resolve(
    "incomeLeviedAfterAdjustment",
    totalIncomeLevied.value - adjustmentDeductionTotal.value
  );
  const incomeLeviedAfterAdjustmentTimes02 = resolve(
    "incomeLeviedAfterAdjustmentTimes02",
    incomeLeviedAfterAdjustment.value * 0.2
  );
  const furusatoNozeiLimit = resolve(
    "furusatoNozeiLimit",
    Math.round(
      incomeLeviedAfterAdjustmentTimes02.value / (1 - 0.1 - incomeTaxRate.value * 1.021) + 2000
    )
  );

  const donationBase = resolve("donationBase", Math.max(furusatoNozeiEffective.value - 2000, 0));
  const donationCreditBasic = resolve("donationCreditBasic", donationBase.value * 0.1);
  const donationCreditSpecial = resolve(
    "donationCreditSpecial",
    Math.min(
      incomeLeviedAfterAdjustmentTimes02.value,
      donationBase.value * (1 - 0.1 - incomeTaxRate.value * 1.021)
    )
  );
  const donationCreditTotal = donationCreditBasic.value + donationCreditSpecial.value;
  const residentTaxRateTotal = residentTaxRateCity.value + residentTaxRatePrefecture.value;
  const donationCreditCity = resolve(
    "donationCreditCity",
    Math.ceil(donationCreditTotal * (residentTaxRateCity.value / residentTaxRateTotal))
  );
  const donationCreditPrefecture = resolve(
    "donationCreditPrefecture",
    Math.ceil(donationCreditTotal * (residentTaxRatePrefecture.value / residentTaxRateTotal))
  );

  const taxCreditCity = resolve(
    "taxCreditCity",
    adjustmentDeductionCity.value + donationCreditCity.value
  );
  const taxCreditPrefecture = resolve(
    "taxCreditPrefecture",
    adjustmentDeductionPrefecture.value + donationCreditPrefecture.value
  );

  const incomeLeviedCityFinal = resolve(
    "incomeLeviedCityFinal",
    Math.max(Math.floor((incomeLeviedCity.value - taxCreditCity.value) / 100) * 100, 0)
  );
  const incomeLeviedPrefectureFinal = resolve(
    "incomeLeviedPrefectureFinal",
    Math.max(Math.floor((incomeLeviedPrefecture.value - taxCreditPrefecture.value) / 100) * 100, 0)
  );

  const perCapitaLevyCity = resolve("perCapitaLevyCity", PER_CAPITA_LEVY_CITY);
  const perCapitaLevyPrefecture = resolve("perCapitaLevyPrefecture", PER_CAPITA_LEVY_PREFECTURE);
  const forestEnvironmentTax = resolve("forestEnvironmentTax", FOREST_ENVIRONMENT_TAX);

  const annualTotal = resolve(
    "annualTotal",
    incomeLeviedCityFinal.value +
      incomeLeviedPrefectureFinal.value +
      perCapitaLevyCity.value +
      perCapitaLevyPrefecture.value +
      forestEnvironmentTax.value
  );

  const elevenMonthAmount = resolve(
    "elevenMonthAmount",
    Math.floor(annualTotal.value / 12 / 100) * 100
  );
  const juneAmount = resolve("juneAmount", annualTotal.value - elevenMonthAmount.value * 11);

  return {
    annualGrossIncome,
    employmentIncome,
    socialInsuranceTotal,
    furusatoNozeiEffective,
    lifeInsuranceGeneralDeductionIncomeTax,
    lifeInsuranceCareMedicalDeductionIncomeTax,
    lifeInsurancePensionDeductionIncomeTax,
    lifeInsuranceForIncomeTax,
    basicDeductionForIncomeTax,
    furusatoDeductionForIncomeTax,
    incomeDeductionTotalForIncomeTax,
    taxableIncomeForIncomeTax,
    incomeTaxRate,
    incomeTaxAmount,
    flatTaxReduction2024,
    baseIncomeTaxAmount,
    reconstructionSurtax,
    incomeTaxAndSurtaxTotal,
    incomeTaxWithheldTotal,
    taxReturnPayment,
    lifeInsuranceGeneralDeductionResidentTax,
    lifeInsuranceCareMedicalDeductionResidentTax,
    lifeInsurancePensionDeductionResidentTax,
    lifeInsuranceForResidentTax,
    basicDeductionForResidentTax,
    incomeDeductionTotalForResidentTax,
    taxableIncomeForResidentTax,
    residentTaxRateCity,
    residentTaxRatePrefecture,
    incomeLeviedCity,
    incomeLeviedPrefecture,
    totalIncomeLevied,
    adjustmentDeductionCity,
    adjustmentDeductionPrefecture,
    adjustmentDeductionTotal,
    incomeLeviedAfterAdjustment,
    incomeLeviedAfterAdjustmentTimes02,
    furusatoNozeiLimit,
    donationBase,
    donationCreditBasic,
    donationCreditSpecial,
    donationCreditCity,
    donationCreditPrefecture,
    taxCreditCity,
    taxCreditPrefecture,
    incomeLeviedCityFinal,
    incomeLeviedPrefectureFinal,
    perCapitaLevyCity,
    perCapitaLevyPrefecture,
    forestEnvironmentTax,
    annualTotal,
    elevenMonthAmount,
    juneAmount,
  };
}
