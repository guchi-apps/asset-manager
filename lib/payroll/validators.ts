// 給与・賞与・項目・保険料率の入力検証（明細ラボの validators.ts から移管。#714）。
// クライアントのフォームとサーバーアクションの両方から使う。
import { z } from "zod"

export const CreateSalarySchema = z.object({
    salaryDate: z.string().datetime("無効な日付形式"),
    grossSalary: z.number().positive("支給額は0より大きい数値が必須"),
    netSalary: z.number().nonnegative("手取額は0以上が必須"),
    data: z.record(z.string(), z.unknown()).optional(),
    memo: z.string().optional(),
})
export type CreateSalary = z.infer<typeof CreateSalarySchema>
export const UpdateSalarySchema = CreateSalarySchema.partial()
export type UpdateSalary = z.infer<typeof UpdateSalarySchema>

export const CreateBonusSchema = z.object({
    bonusDate: z.string().datetime("無効な日付形式"),
    amount: z.number().positive("支給額は0より大きい数値が必須"),
    data: z.record(z.string(), z.unknown()).optional(),
    memo: z.string().optional(),
})
export type CreateBonus = z.infer<typeof CreateBonusSchema>
export const UpdateBonusSchema = CreateBonusSchema.partial()
export type UpdateBonus = z.infer<typeof UpdateBonusSchema>

export const ItemTypeEnum = z.enum(["earning", "otherEarning", "otherTaxable", "statutoryDeduction", "deduction"])
export const ItemScopeEnum = z.enum(["salary", "bonus", "both"])

export const CreateItemSchema = z.object({
    itemName: z.string().trim().min(1, "項目名は必須").max(50),
    itemType: ItemTypeEnum,
    scope: ItemScopeEnum.optional(),
    isTaxable: z.boolean().optional(),
    displayOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
})
export type CreateItem = z.infer<typeof CreateItemSchema>
export const UpdateItemSchema = CreateItemSchema.partial()
export type UpdateItem = z.infer<typeof UpdateItemSchema>

const insuranceRateSchema = z.number().positive().multipleOf(0.0001, "小数点以下4桁までで入力してください")

export const CreateTaxSettingSchema = z.object({
    effectiveYear: z.number().int().min(2000).max(2100),
    effectiveMonth: z.number().int().min(1).max(12),
    healthInsuranceRate: insuranceRateSchema.optional(),
    pensionRate: insuranceRateSchema.optional(),
    employmentInsuranceRate: insuranceRateSchema.optional(),
    incomeRateTaxFormula: z.string().optional(),
})
export type CreateTaxSetting = z.infer<typeof CreateTaxSettingSchema>

export const SALARY_DATE_CONFLICT_MESSAGE =
    "同じ支給日の給与明細がすでにあります。既存の明細を編集するか、別の支給日を指定してください"
export const BONUS_DATE_CONFLICT_MESSAGE =
    "同じ支給日の賞与明細がすでにあります。既存の明細を編集するか、別の支給日を指定してください"
export const ITEM_NAME_CONFLICT_MESSAGE = "同じ名前の項目がすでにあります。別の名前にしてください"

/** zod の検証エラーを、画面に出す1文にまとめる */
export function describeValidationError(error: z.ZodError): string {
    return error.issues[0]?.message ?? "入力内容を確かめてください"
}

const PRISMA_UNIQUE_CONSTRAINT_CODE = "P2002"

export function isUniqueConstraintError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: unknown }).code === PRISMA_UNIQUE_CONSTRAINT_CODE
    )
}
