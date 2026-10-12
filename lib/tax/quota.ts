// ふるさと納税の残り枠の計算。残り枠カードと相談用スナップショットが「同じ値」を参照するための唯一の入口。
// 明細ラボでは、カードは画面上の試算値・源泉徴収票の上書きを反映し、スナップショットは別に計算していたため、
// 上書きがあると両者の上限額・寄付済額がずれ得た。ここへ寄せて、状態（試算値）を1か所から渡す。
import { calculateAnnualResidentTax, type ResidentTaxOverrides } from "./annual-tax";
import type { FurusatoNozeiIncomeProjection } from "./aggregate";
import type { DonationSummary } from "./donation";
import type { DeductionType } from "./types";

export type QuotaStatus = "over" | "confirmed" | "estimate";

export type QuotaInput = {
  projection: FurusatoNozeiIncomeProjection;
  /** 保存済み、または編集中の年次控除（寄付の調整額・生命保険料） */
  amounts: Partial<Record<DeductionType, number>>;
  overrides: ResidentTaxOverrides;
  donation: DonationSummary;
  /** 試算欄の年収・社会保険料。未入力は 0 として扱う */
  grossIncome: number | undefined;
  socialInsuranceTotal: number | undefined;
};

export type Quota = {
  /** 寄付済額。寄付明細の合計 + 調整額（`furusatoNozeiEffective` の上書きがあればそれ） */
  donated: number;
  /** 調整額（編集中の値を優先） */
  adjustment: number;
  limit: number;
  /** 試算値を変える前（実績＋見込み、または源泉徴収票の値）の上限額 */
  baseLimit: number;
  remaining: number;
  baseRemaining: number;
  excess: number;
  baseGrossIncome: number;
  baseSocialInsuranceTotal: number;
  /** 源泉徴収票の値（年収・社保・源泉徴収額）がそろって上書きされている */
  isWithholdingConfirmed: boolean;
  status: QuotaStatus;
};

export function computeQuota(input: QuotaInput): Quota {
  const { projection, amounts, overrides, donation, grossIncome, socialInsuranceTotal } = input;

  const baseGrossIncome = overrides.annualGrossIncome ?? projection.estimatedGrossIncome;
  const baseSocialInsuranceTotal = overrides.socialInsuranceTotal ?? projection.estimatedSocialInsuranceTotal;

  // 年収・社会保険料は試算欄で変えるため、手入力の上書きからは外して渡す。
  // それ以外の上書き（上限額そのものの上書きなど）は尊重する。
  const limitOverrides: ResidentTaxOverrides = { ...overrides };
  delete limitOverrides.annualGrossIncome;
  delete limitOverrides.socialInsuranceTotal;

  const adjustment = amounts.furusatoNozei ?? donation.adjustment;
  const donated = overrides.furusatoNozeiEffective ?? donation.total + adjustment;

  const calculateLimit = (annualGrossIncome: number, insuranceTotal: number) =>
    Math.max(
      calculateAnnualResidentTax(
        {
          annualGrossIncome,
          socialInsuranceTotal: insuranceTotal,
          lifeInsuranceGeneral: amounts.lifeInsuranceGeneral ?? 0,
          lifeInsuranceCareMedical: amounts.lifeInsuranceCareMedical ?? 0,
          lifeInsurancePension: amounts.lifeInsurancePension ?? 0,
          furusatoNozei: donated,
          incomeTaxWithheldTotal: 0,
        },
        limitOverrides
      ).furusatoNozeiLimit.value,
      0
    );

  const limit = calculateLimit(grossIncome ?? 0, socialInsuranceTotal ?? 0);
  const baseLimit = calculateLimit(baseGrossIncome, baseSocialInsuranceTotal);
  const excess = Math.max(donated - limit, 0);
  const isWithholdingConfirmed =
    overrides.annualGrossIncome !== undefined &&
    overrides.socialInsuranceTotal !== undefined &&
    overrides.incomeTaxWithheldTotal !== undefined;

  return {
    donated,
    adjustment,
    limit,
    baseLimit,
    remaining: Math.max(limit - donated, 0),
    baseRemaining: Math.max(baseLimit - donated, 0),
    excess,
    baseGrossIncome,
    baseSocialInsuranceTotal,
    isWithholdingConfirmed,
    status: excess > 0 ? "over" : isWithholdingConfirmed ? "confirmed" : "estimate",
  };
}
