// 1つの年の画面状態（試算値・控除・上書き・寄付）から、相談用スナップショットを組み立てる。
// 残り枠は `computeQuota`、所得税・住民税の試算は計算過程の表と同じ `calculateAnnualResidentTax` を使い、
// 画面とスナップショットが同じ値を指すようにする。
import { calculateAnnualResidentTax, type ResidentTaxOverrides } from "./annual-tax";
import type { AnnualAggregate, FurusatoNozeiIncomeProjection } from "./aggregate";
import { withAdjustment, type DonationSummary } from "./donation";
import { computeQuota } from "./quota";
import { buildTaxSnapshot, type TaxSnapshot } from "./snapshot";
import type { DeductionType } from "./types";

export type TaxViewState = {
  year: number;
  isLocked: boolean;
  aggregate: AnnualAggregate;
  projection: FurusatoNozeiIncomeProjection;
  amounts: Partial<Record<DeductionType, number>>;
  overrides: ResidentTaxOverrides;
  donation: DonationSummary;
  /** 試算欄の値（残り枠カードと共有する） */
  estimatedGrossIncome: number | undefined;
  estimatedSocialInsuranceTotal: number | undefined;
};

export function buildSnapshotFromState(state: TaxViewState, generatedAt: Date, appVersion: string): TaxSnapshot {
  const { aggregate, projection, amounts, overrides, donation } = state;
  const quota = computeQuota({
    projection,
    amounts,
    overrides,
    donation,
    grossIncome: state.estimatedGrossIncome,
    socialInsuranceTotal: state.estimatedSocialInsuranceTotal,
  });
  // 計算過程の表と同じく、実績値（保存済みの上書きを反映）から求める
  const actual = calculateAnnualResidentTax(
    {
      annualGrossIncome: aggregate.grossIncome,
      socialInsuranceTotal: aggregate.socialInsuranceTotal,
      lifeInsuranceGeneral: amounts.lifeInsuranceGeneral ?? 0,
      lifeInsuranceCareMedical: amounts.lifeInsuranceCareMedical ?? 0,
      lifeInsurancePension: amounts.lifeInsurancePension ?? 0,
      furusatoNozei: donation.total + quota.adjustment,
      incomeTaxWithheldTotal: aggregate.incomeTaxWithheldTotal,
    },
    overrides
  );

  return buildTaxSnapshot({
    year: state.year,
    generatedAt,
    appVersion,
    isLocked: state.isLocked,
    actual: {
      grossIncome: aggregate.grossIncome,
      socialInsuranceTotal: aggregate.socialInsuranceTotal,
      incomeTaxWithheldTotal: aggregate.incomeTaxWithheldTotal,
    },
    projected: {
      grossIncome: state.estimatedGrossIncome ?? 0,
      socialInsuranceTotal: state.estimatedSocialInsuranceTotal ?? 0,
      salaryMonths: projection.projectedSalaryMonthCount,
      bonusMonths: projection.projectedBonusMonths,
    },
    registeredSalaryCount: aggregate.salaryCount,
    registeredBonusCount: aggregate.bonusCount,
    premiums: {
      lifeInsuranceGeneral: amounts.lifeInsuranceGeneral ?? 0,
      lifeInsuranceCareMedical: amounts.lifeInsuranceCareMedical ?? 0,
      lifeInsurancePension: amounts.lifeInsurancePension ?? 0,
    },
    furusato: { limit: quota.limit, donated: quota.donated, status: quota.status },
    donations: withAdjustment(donation, quota.adjustment),
    tax: {
      employmentIncome: actual.employmentIncome.value,
      incomeDeductionTotalForIncomeTax: actual.incomeDeductionTotalForIncomeTax.value,
      taxableIncomeForIncomeTax: actual.taxableIncomeForIncomeTax.value,
      incomeTaxRate: actual.incomeTaxRate.value,
      incomeTaxAndSurtaxTotal: actual.incomeTaxAndSurtaxTotal.value,
      taxReturnPayment: actual.taxReturnPayment.value,
      residentTaxAnnualTotal: actual.annualTotal.value,
    },
  });
}
