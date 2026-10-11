import { redirect } from "next/navigation"

import { SalaryForm } from "@/components/payroll/salary-form"
import { getCurrentUserId } from "@/lib/auth"
import { getSalaryFormData } from "@/lib/payroll/queries"

export const dynamic = "force-dynamic"

export default async function NewSalaryPage() {
    const userId = await getCurrentUserId()
    if (!userId) redirect("/login")

    const data = await getSalaryFormData(userId)
    if (!data) redirect("/salaries")
    return (
        <div className="space-y-4 pt-4">
            <h1 className="text-xl font-semibold">給与を登録</h1>
            <SalaryForm
                taxSetting={data.taxSetting}
                items={data.items}
                previousStandardMonthlyRemuneration={data.previousStandardMonthlyRemuneration}
                previousSalaryData={data.previousSalaryData}
                pdfImportPayday={data.pdfImportPayday}
            />
        </div>
    )
}
