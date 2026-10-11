import { notFound, redirect } from "next/navigation"

import { BonusForm } from "@/components/payroll/bonus-form"
import { getCurrentUserId } from "@/lib/auth"
import { getBonusFormData } from "@/lib/payroll/queries"

export const dynamic = "force-dynamic"

export default async function EditBonusPage({ params }: { params: Promise<{ id: string }> }) {
    const userId = await getCurrentUserId()
    if (!userId) redirect("/login")

    const { id } = await params
    // 他のユーザーの明細は userId で絞った時点で見つからず、404になる
    const data = await getBonusFormData(userId, id)
    if (!data) notFound()
    return (
        <div className="space-y-4 pt-4">
            <h1 className="text-xl font-semibold">賞与を編集</h1>
            <BonusForm
                bonus={data.bonus}
                taxSetting={data.taxSetting}
                items={data.items}
                previousMonthTaxableSalary={data.previousMonthTaxableSalary}
            />
        </div>
    )
}
