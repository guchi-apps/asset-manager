// 給与・賞与（Issue #714。明細ラボから移管）の画面とサーバーアクションで受け渡す型。
// Prisma の `Decimal` はシリアライズで文字列になるため、金額・料率は文字列で持ち、使う側で Number() する。
// クライアントからも import するため、この lib は `db` に依存させない。

export type SalaryDTO = {
    id: string
    userId: string
    salaryDate: string
    grossSalary: string
    netSalary: string
    data: Record<string, unknown>
    memo: string | null
    createdAt: string
    updatedAt: string
    deletedAt: string | null
}

export type BonusDTO = {
    id: string
    userId: string
    bonusDate: string
    amount: string
    data: Record<string, unknown>
    memo: string | null
    createdAt: string
    updatedAt: string
    deletedAt: string | null
}

export type ItemType = "earning" | "otherEarning" | "otherTaxable" | "statutoryDeduction" | "deduction"
export type ItemScope = "salary" | "bonus" | "both"

export type ItemDTO = {
    id: string
    userId: string
    itemName: string
    itemType: ItemType
    scope: ItemScope
    isTaxable: boolean
    displayOrder: number
    isActive: boolean
    createdAt: string
    updatedAt: string
}

/** 編集画面用。明細に金額が載っているが、無効・適用範囲外・削除済みの項目には理由を `statusNote` に持たせる */
export type EditableItemDTO = ItemDTO & { statusNote?: string }

export type TaxSettingDTO = {
    id: string
    userId: string
    effectiveFrom: string
    healthInsuranceRate: string
    pensionRate: string
    employmentInsuranceRate: string
    incomeRateTaxFormula: string | null
    createdAt: string
    updatedAt: string
}

/**
 * 控除系の項目でも、追加徴収と還付の両方があり得るため符号を保持する項目名（明細ラボの annualTax.ts と同じ）。
 * 控除系の金額は通常マイナスで保存し、画面では絶対値で扱う。
 */
export const INCOME_TAX_ADJUSTMENT_ITEM_NAMES = ["年末調整", "所得税(差額)"]

/** サーバーアクションの結果。失敗時は画面にそのまま出せる理由を返す */
export type PayrollActionResult<T = undefined> =
    | { success: true; data: T }
    | { success: false; error: string }

/** サーバーから受け取った Prisma の行を、クライアントへ渡せる素の値（Decimal・Date を文字列）にする */
export function toDto<T>(value: unknown): T {
    return JSON.parse(JSON.stringify(value)) as T
}
