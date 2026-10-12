// 年次税務（Issue #716。明細ラボの確定申告データから移管）の画面とサーバーアクションで受け渡す型。
// クライアントからも import するため、この lib は `db` に依存させない。

/**
 * 年次控除の種類。`furusatoNozei` は「寄付明細に載せていない調整額」だけを意味する。
 * 寄付済額は 寄付明細の合計 + この調整額（`effectiveTotal`）で、明細の合計をここへ書き写してはいけない（二重計上）。
 */
export const DEDUCTION_TYPES = [
  "lifeInsuranceGeneral",
  "lifeInsuranceCareMedical",
  "lifeInsurancePension",
  "furusatoNozei",
] as const;

export type DeductionType = (typeof DEDUCTION_TYPES)[number];

export type TaxActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };
