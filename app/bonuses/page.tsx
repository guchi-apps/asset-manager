import { redirect } from "next/navigation"

import { BonusesClient } from "@/components/payroll/bonus-list"
import { getCurrentUserId } from "@/lib/auth"
import { getBonusListData } from "@/lib/payroll/queries"

export const dynamic = "force-dynamic"

// 賞与一覧（Issue #714。明細ラボの /bonuses から移管）
export default async function BonusesPage() {
    const userId = await getCurrentUserId()
    if (!userId) redirect("/login")

    const { bonuses, items } = await getBonusListData(userId)
    return (
        <div className="pt-4">
            <BonusesClient bonuses={bonuses} items={items} />
        </div>
    )
}
