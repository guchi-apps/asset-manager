// 給与・賞与・項目・保険料率の読み書き（Issue #714。明細ラボの app/api/{salaries,bonuses,items,tax-settings} から移管）。
// サーバー専用（`prisma` に依存する）。クライアントコンポーネントから import しないこと。
//
// すべての読み書きを `userId` で絞る。他のユーザーの明細は、id を知っていても読めず、書き換えられない。
// 給与・賞与は資産（Asset）・取引（Transaction）・Zaimと独立した記録で、ここからそれらへは一切書き込まない。
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import { freezeItemDefinition, withItemSnapshots } from "@/lib/payroll/item-snapshot-server"
import {
    BONUS_DATE_CONFLICT_MESSAGE,
    ITEM_NAME_CONFLICT_MESSAGE,
    SALARY_DATE_CONFLICT_MESSAGE,
    isUniqueConstraintError,
    type CreateBonus,
    type CreateItem,
    type CreateSalary,
    type CreateTaxSetting,
    type UpdateBonus,
    type UpdateItem,
    type UpdateSalary,
} from "@/lib/payroll/validators"
import type { PayrollActionResult } from "@/lib/payroll/types"

// 項目の定義を変えると全明細を1件ずつ書き換えるため、明細数が多くても既定の5秒で打ち切られないようにする
const TRANSACTION_OPTIONS = { timeout: 30_000 }

const NOT_FOUND = "対象の明細が見つかりません。画面を読み込み直してください"

export function buildEffectiveFrom(year: number, month: number): Date {
    return new Date(Date.UTC(year, month - 1, 1))
}

export function findApplicableTaxSetting(userId: string, asOf: Date) {
    return prisma.taxSetting.findFirst({
        where: { userId, effectiveFrom: { lte: asOf } },
        orderBy: { effectiveFrom: "desc" },
    })
}

// --- 給与 ---

export async function createSalary(userId: string, input: CreateSalary): Promise<PayrollActionResult<{ id: string }>> {
    const salaryDate = new Date(input.salaryDate)
    const data = (await withItemSnapshots(userId, input.data ?? {})) as Prisma.InputJsonValue
    try {
        // 削除済み（論理削除）の同日の行が一意制約に残っていると登録できないため、先に取り除く。
        // 有効な同日の行があればcreateが一意制約違反になり、トランザクションごと巻き戻る（既存の明細は変わらない）。
        const salary = await prisma.$transaction(async (tx) => {
            await tx.salary.deleteMany({ where: { userId, salaryDate, deletedAt: { not: null } } })
            return tx.salary.create({
                data: {
                    userId,
                    salaryDate,
                    grossSalary: input.grossSalary,
                    netSalary: input.netSalary,
                    memo: input.memo,
                    data,
                },
            })
        })
        return { success: true, data: { id: salary.id } }
    } catch (error) {
        if (isUniqueConstraintError(error)) return { success: false, error: SALARY_DATE_CONFLICT_MESSAGE }
        throw error
    }
}

export async function updateSalary(
    userId: string,
    id: string,
    input: UpdateSalary
): Promise<PayrollActionResult<{ id: string }>> {
    const existing = await prisma.salary.findFirst({ where: { id, userId, deletedAt: null } })
    if (!existing) return { success: false, error: NOT_FOUND }

    const { salaryDate, data, ...rest } = input
    const nextDate = salaryDate ? new Date(salaryDate) : undefined
    const updateData: Prisma.SalaryUpdateInput = {
        ...rest,
        ...(nextDate && { salaryDate: nextDate }),
        ...(data && {
            data: (await withItemSnapshots(userId, data, existing.data)) as Prisma.InputJsonValue,
        }),
    }

    try {
        // 支給日を変える場合、変更先に削除済み（論理削除）の行があると一意制約に当たるため先に取り除く。
        // 有効な同日の行があればupdateが一意制約違反になり、トランザクションごと巻き戻る。
        await prisma.$transaction(async (tx) => {
            if (nextDate) {
                await tx.salary.deleteMany({
                    where: { userId, salaryDate: nextDate, deletedAt: { not: null }, id: { not: id } },
                })
            }
            await tx.salary.update({ where: { id: existing.id }, data: updateData })
        })
        return { success: true, data: { id } }
    } catch (error) {
        if (isUniqueConstraintError(error)) return { success: false, error: SALARY_DATE_CONFLICT_MESSAGE }
        throw error
    }
}

export async function deleteSalary(userId: string, id: string): Promise<PayrollActionResult> {
    const { count } = await prisma.salary.updateMany({
        where: { id, userId, deletedAt: null },
        data: { deletedAt: new Date() },
    })
    if (count === 0) return { success: false, error: NOT_FOUND }
    return { success: true, data: undefined }
}

// --- 賞与 ---

export async function createBonus(userId: string, input: CreateBonus): Promise<PayrollActionResult<{ id: string }>> {
    const bonusDate = new Date(input.bonusDate)
    const data = (await withItemSnapshots(userId, input.data ?? {})) as Prisma.InputJsonValue
    try {
        const bonus = await prisma.$transaction(async (tx) => {
            await tx.bonus.deleteMany({ where: { userId, bonusDate, deletedAt: { not: null } } })
            return tx.bonus.create({
                data: { userId, bonusDate, amount: input.amount, memo: input.memo, data },
            })
        })
        return { success: true, data: { id: bonus.id } }
    } catch (error) {
        if (isUniqueConstraintError(error)) return { success: false, error: BONUS_DATE_CONFLICT_MESSAGE }
        throw error
    }
}

export async function updateBonus(
    userId: string,
    id: string,
    input: UpdateBonus
): Promise<PayrollActionResult<{ id: string }>> {
    const existing = await prisma.bonus.findFirst({ where: { id, userId, deletedAt: null } })
    if (!existing) return { success: false, error: NOT_FOUND }

    const { bonusDate, data, ...rest } = input
    const nextDate = bonusDate ? new Date(bonusDate) : undefined
    const updateData: Prisma.BonusUpdateInput = {
        ...rest,
        ...(nextDate && { bonusDate: nextDate }),
        ...(data && {
            data: (await withItemSnapshots(userId, data, existing.data)) as Prisma.InputJsonValue,
        }),
    }

    try {
        await prisma.$transaction(async (tx) => {
            if (nextDate) {
                await tx.bonus.deleteMany({
                    where: { userId, bonusDate: nextDate, deletedAt: { not: null }, id: { not: id } },
                })
            }
            await tx.bonus.update({ where: { id: existing.id }, data: updateData })
        })
        return { success: true, data: { id } }
    } catch (error) {
        if (isUniqueConstraintError(error)) return { success: false, error: BONUS_DATE_CONFLICT_MESSAGE }
        throw error
    }
}

export async function deleteBonus(userId: string, id: string): Promise<PayrollActionResult> {
    const { count } = await prisma.bonus.updateMany({
        where: { id, userId, deletedAt: null },
        data: { deletedAt: new Date() },
    })
    if (count === 0) return { success: false, error: NOT_FOUND }
    return { success: true, data: undefined }
}

// --- 項目 ---

export async function createPayItem(userId: string, input: CreateItem): Promise<PayrollActionResult<{ id: string }>> {
    const maxOrder = await prisma.payItem.aggregate({ where: { userId }, _max: { displayOrder: true } })
    try {
        const item = await prisma.payItem.create({
            data: {
                userId,
                ...input,
                displayOrder: input.displayOrder ?? (maxOrder._max.displayOrder ?? -1) + 1,
            },
        })
        return { success: true, data: { id: item.id } }
    } catch (error) {
        if (isUniqueConstraintError(error)) return { success: false, error: ITEM_NAME_CONFLICT_MESSAGE }
        throw error
    }
}

export async function updatePayItem(userId: string, id: string, input: UpdateItem): Promise<PayrollActionResult> {
    const existing = await prisma.payItem.findFirst({ where: { id, userId } })
    if (!existing) return { success: false, error: "対象の項目が見つかりません。画面を読み込み直してください" }

    // 名前・種別・課税対象を変えると、明細の集計が現在の項目定義を見ている限り過去の明細の計算まで変わる。
    // 変更前の定義を既存の明細へ写してから更新する（明細ラボ#212）
    const changesDefinition =
        (input.itemName !== undefined && input.itemName !== existing.itemName) ||
        (input.itemType !== undefined && input.itemType !== existing.itemType) ||
        (input.isTaxable !== undefined && input.isTaxable !== existing.isTaxable)

    try {
        await prisma.$transaction(async (tx) => {
            if (changesDefinition) await freezeItemDefinition(tx, userId, existing)
            await tx.payItem.update({ where: { id: existing.id }, data: input })
        }, TRANSACTION_OPTIONS)
        return { success: true, data: undefined }
    } catch (error) {
        if (isUniqueConstraintError(error)) return { success: false, error: ITEM_NAME_CONFLICT_MESSAGE }
        throw error
    }
}

/** 表示順を並べ直す。渡された id の順に 0 から振り直す（他ユーザーの id は無視される） */
export async function reorderPayItems(userId: string, orderedIds: string[]): Promise<PayrollActionResult> {
    await prisma.$transaction(
        orderedIds.map((id, index) =>
            prisma.payItem.updateMany({ where: { id, userId }, data: { displayOrder: index } })
        )
    )
    return { success: true, data: undefined }
}

// --- 保険料率 ---

export async function saveTaxSetting(userId: string, input: CreateTaxSetting): Promise<PayrollActionResult> {
    const { effectiveYear, effectiveMonth, ...rates } = input
    const effectiveFrom = buildEffectiveFrom(effectiveYear, effectiveMonth)
    await prisma.taxSetting.upsert({
        where: { userId_effectiveFrom: { userId, effectiveFrom } },
        update: rates,
        create: { userId, effectiveFrom, ...rates },
    })
    return { success: true, data: undefined }
}

export async function deleteTaxSetting(userId: string, id: string): Promise<PayrollActionResult> {
    const { count } = await prisma.taxSetting.deleteMany({ where: { id, userId } })
    if (count === 0) return { success: false, error: "対象の設定が見つかりません。画面を読み込み直してください" }
    return { success: true, data: undefined }
}
