import { redirect } from "next/navigation"

import { BonusForm } from "@/components/payroll/bonus-form"
import { getCurrentUserId } from "@/lib/auth"
import { getBonusFormData } from "@/lib/payroll/queries"

export const dynamic = "force-dynamic"

export default async function NewBonusPage() {
    const userId = await getCurrentUserId()
    if (!userId) redirect("/login")

    const data = await getBonusFormData(userId)
    if (!data) redirect("/bonuses")
    return (
        <div className="space-y-4 pt-4">
            <h1 className="text-xl font-semibold">賞与を登録</h1>
            <BonusForm
                taxSetting={data.taxSetting}
                items={data.items}
                previousMonthTaxableSalary={data.previousMonthTaxableSalary}
            />
        </div>
    )
}
