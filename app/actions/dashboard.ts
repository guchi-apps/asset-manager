"use server"

import { getFinancialSnapshot } from "@/lib/user-financial-snapshot"
import { getTagGroups } from "@/app/actions/tags"
import { getDefaultTimeRange } from "@/app/actions/settings"

export async function getDashboardData() {
    const [{ categories, historyPoints, investmentHistoryPoints }, tagGroups, defaultTimeRange] = await Promise.all([
        getFinancialSnapshot(),
        getTagGroups(),
        getDefaultTimeRange(),
    ])

    return {
        categories,
        history: historyPoints,
        investmentHistory: investmentHistoryPoints,
        tagGroups,
        defaultTimeRange,
    }
}
