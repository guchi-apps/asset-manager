import { notFound, redirect } from "next/navigation"

import { SalaryForm } from "@/components/payroll/salary-form"
import { getCurrentUserId } from "@/lib/auth"
import { getSalaryFormData } from "@/lib/payroll/queries"

export const dynamic = "force-dynamic"

export default async function EditSalaryPage({ params }: { params: Promise<{ id: string }> }) {
    const userId = await getCurrentUserId()
    if (!userId) redirect("/login")

    const { id } = await params
    // 他のユーザーの明細は userId で絞った時点で見つからず、404になる
    const data = await getSalaryFormData(userId, id)
    if (!data) notFound()
    return (
        <div className="space-y-4 pt-4">
            <h1 className="text-xl font-semibold">給与を編集</h1>
            <SalaryForm
                salary={data.salary}
                taxSetting={data.taxSetting}
                items={data.items}
                previousStandardMonthlyRemuneration={data.previousStandardMonthlyRemuneration}
                previousSalaryData={data.previousSalaryData}
            />
        </div>
    )
}
