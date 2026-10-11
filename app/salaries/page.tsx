import { redirect } from "next/navigation"

import { SalariesContent } from "@/components/payroll/salaries-content"
import { getCurrentUserId } from "@/lib/auth"
import { getBonusListData, getSalaryListData } from "@/lib/payroll/queries"

export const dynamic = "force-dynamic"

// 給与一覧（Issue #714。明細ラボの /salaries から移管）
export default async function SalariesPage() {
    const userId = await getCurrentUserId()
    if (!userId) redirect("/login")

    const [{ salaries, items }, { bonuses }] = await Promise.all([
        getSalaryListData(userId),
        getBonusListData(userId),
    ])
    return (
        <div className="pt-4">
            <SalariesContent salaries={salaries} bonuses={bonuses} items={items} />
        </div>
    )
}
