import { redirect } from "next/navigation"

import { PayrollSettingsView } from "@/components/payroll/payroll-settings-view"
import { getCurrentUserId } from "@/lib/auth"
import { getPayrollSettingsData } from "@/lib/payroll/queries"

export const dynamic = "force-dynamic"

// 給与・賞与の項目と保険料率（Issue #714。明細ラボの /settings/items と /settings の保険料率から移管）
export default async function PayrollSettingsPage({
    searchParams,
}: {
    searchParams: Promise<{ year?: string; month?: string }>
}) {
    const userId = await getCurrentUserId()
    if (!userId) redirect("/login")

    const { year: yearParam, month: monthParam } = await searchParams
    const now = new Date()
    const year = clampInt(yearParam, 2000, 2100) ?? now.getFullYear()
    const month = clampInt(monthParam, 1, 12) ?? now.getMonth() + 1

    const data = await getPayrollSettingsData(userId, year, month)

    return <PayrollSettingsView data={data} year={year} month={month} />
}

function clampInt(value: string | undefined, min: number, max: number): number | undefined {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined
}
