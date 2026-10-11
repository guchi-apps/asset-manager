// 給与・賞与の画面が読むデータ（Issue #714。明細ラボの各 page.tsx の読み出しを移管）。
// サーバー専用。すべて `userId` で絞る。
import { prisma } from "@/lib/prisma"
import { calculatePreviousMonthTaxableSalary } from "@/lib/payroll/calculations"
import { resolveEditableItems, savedItemIds } from "@/lib/payroll/editable-items"
import { buildEffectiveFrom, findApplicableTaxSetting } from "@/lib/payroll/service"
import {
    toDto,
    type BonusDTO,
    type EditableItemDTO,
    type ItemDTO,
    type SalaryDTO,
    type TaxSettingDTO,
} from "@/lib/payroll/types"

function numberField(data: unknown, key: string): number | undefined {
    if (typeof data !== "object" || data === null) return undefined
    const value = (data as Record<string, unknown>)[key]
    return typeof value === "number" ? value : undefined
}

export async function getSalaryListData(userId: string) {
    const [salaries, items] = await Promise.all([
        prisma.salary.findMany({ where: { userId, deletedAt: null }, orderBy: { salaryDate: "desc" } }),
        prisma.payItem.findMany({
            where: { userId, scope: { in: ["salary", "both"] } },
            orderBy: { displayOrder: "asc" },
        }),
    ])
    return { salaries: toDto<SalaryDTO[]>(salaries), items: toDto<ItemDTO[]>(items) }
}

export async function getBonusListData(userId: string) {
    const [bonuses, items] = await Promise.all([
        prisma.bonus.findMany({ where: { userId, deletedAt: null }, orderBy: { bonusDate: "desc" } }),
        prisma.payItem.findMany({
            where: { userId, scope: { in: ["bonus", "both"] } },
            orderBy: { displayOrder: "asc" },
        }),
    ])
    return { bonuses: toDto<BonusDTO[]>(bonuses), items: toDto<ItemDTO[]>(items) }
}

export interface SalaryFormData {
    salary?: SalaryDTO
    taxSetting: TaxSettingDTO | null
    items: EditableItemDTO[]
    previousStandardMonthlyRemuneration?: number
    previousSalaryData?: Record<string, unknown>
    /** 新規登録のときだけ。給与明細PDFには年月しか無いため、支給日の「日」に前回の支給日を使う */
    pdfImportPayday?: number
}

/** 給与の新規登録（id 無し）・編集（id あり）の画面のデータ。編集対象が無ければ null */
export async function getSalaryFormData(userId: string, id?: string): Promise<SalaryFormData | null> {
    const salary = id ? await prisma.salary.findFirst({ where: { id, userId, deletedAt: null } }) : null
    if (id && !salary) return null

    // 無効化・適用範囲の変更をした項目でも、この明細に金額があるものは読み込む（保存時に金額が消えないように。明細ラボ#211）
    const savedIds = salary ? savedItemIds(salary.data) : []
    const [taxSetting, items, previousSalary] = await Promise.all([
        findApplicableTaxSetting(userId, salary?.salaryDate ?? new Date()),
        prisma.payItem.findMany({
            where: {
                userId,
                OR: [{ isActive: true, scope: { in: ["salary", "both"] } }, { id: { in: savedIds } }],
            },
            orderBy: { displayOrder: "asc" },
        }),
        prisma.salary.findFirst({
            where: { userId, deletedAt: null, ...(salary && { salaryDate: { lt: salary.salaryDate } }) },
            orderBy: { salaryDate: "desc" },
        }),
    ])

    const previousSalaryData = previousSalary?.data as Record<string, unknown> | undefined
    return {
        salary: salary ? toDto<SalaryDTO>(salary) : undefined,
        taxSetting: taxSetting ? toDto<TaxSettingDTO>(taxSetting) : null,
        items: resolveEditableItems(toDto<ItemDTO[]>(items), salary?.data, "salary"),
        previousStandardMonthlyRemuneration: numberField(previousSalaryData, "standardMonthlyRemuneration"),
        previousSalaryData,
        // 支給日は日付入力の値を UTC の0時として保存している
        pdfImportPayday: salary ? undefined : previousSalary ? previousSalary.salaryDate.getUTCDate() : 25,
    }
}

export interface BonusFormData {
    bonus?: BonusDTO
    taxSetting: TaxSettingDTO | null
    items: EditableItemDTO[]
    previousMonthTaxableSalary?: number
}

/** 賞与の新規登録（id 無し）・編集（id あり）の画面のデータ。編集対象が無ければ null */
export async function getBonusFormData(userId: string, id?: string): Promise<BonusFormData | null> {
    const bonus = id ? await prisma.bonus.findFirst({ where: { id, userId, deletedAt: null } }) : null
    if (id && !bonus) return null

    const savedIds = bonus ? savedItemIds(bonus.data) : []
    const [taxSetting, items, salaryItems, previousSalary] = await Promise.all([
        findApplicableTaxSetting(userId, bonus?.bonusDate ?? new Date()),
        prisma.payItem.findMany({
            where: {
                userId,
                OR: [{ isActive: true, scope: { in: ["bonus", "both"] } }, { id: { in: savedIds } }],
            },
            orderBy: { displayOrder: "asc" },
        }),
        prisma.payItem.findMany({ where: { userId, scope: { in: ["salary", "both"] } } }),
        prisma.salary.findFirst({
            where: { userId, deletedAt: null, ...(bonus && { salaryDate: { lt: bonus.bonusDate } }) },
            orderBy: { salaryDate: "desc" },
        }),
    ])

    return {
        bonus: bonus ? toDto<BonusDTO>(bonus) : undefined,
        taxSetting: taxSetting ? toDto<TaxSettingDTO>(taxSetting) : null,
        items: resolveEditableItems(toDto<ItemDTO[]>(items), bonus?.data, "bonus"),
        previousMonthTaxableSalary: previousSalary
            ? calculatePreviousMonthTaxableSalary(
                  {
                      grossSalary: Number(previousSalary.grossSalary),
                      data: previousSalary.data as Record<string, unknown>,
                  },
                  salaryItems
              )
            : undefined,
    }
}

/** 項目・保険料率の画面のデータ。`year`・`month` は保険料率の入力欄に出す適用開始年月 */
export async function getPayrollSettingsData(userId: string, year: number, month: number) {
    const effectiveFrom = buildEffectiveFrom(year, month)
    const [items, taxSetting, applicableTaxSetting, allTaxSettings] = await Promise.all([
        prisma.payItem.findMany({ where: { userId }, orderBy: { displayOrder: "asc" } }),
        prisma.taxSetting.findUnique({ where: { userId_effectiveFrom: { userId, effectiveFrom } } }),
        findApplicableTaxSetting(userId, effectiveFrom),
        prisma.taxSetting.findMany({ where: { userId }, orderBy: { effectiveFrom: "desc" } }),
    ])
    return {
        items: toDto<ItemDTO[]>(items),
        taxSetting: taxSetting ? toDto<TaxSettingDTO>(taxSetting) : null,
        applicableTaxSetting: applicableTaxSetting ? toDto<TaxSettingDTO>(applicableTaxSetting) : null,
        taxSettings: toDto<TaxSettingDTO[]>(allTaxSettings),
    }
}
