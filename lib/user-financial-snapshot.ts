import { cache } from "react"
import { unstable_cache } from "next/cache"
import { prisma } from "@/lib/prisma"
import { getCurrentUserId } from "@/lib/auth"
import { dashboardCacheTag } from "@/lib/dashboard-cache"
import {
    computeHistoryPoints,
    type HistoryCategory,
    type HistoryPoint,
} from "@/lib/history-compute"
import { resolveCategoryPurposes, type AccountPurpose } from "@/lib/account-purpose"
import {
    mapCategoriesFromRows,
    type CategoryWithRelations,
} from "@/lib/map-categories"

const categoryInclude = {
    tags: {
        include: {
            tagGroup: true,
            tagOption: true,
        },
    },
    assets: {
        orderBy: { recordedAt: "desc" as const },
        take: 40,
        select: {
            recordedAt: true,
            currentValue: true,
        },
    },
    transactions: {
        select: {
            transactedAt: true,
            amount: true,
            type: true,
            realizedGain: true,
        },
    },
}

function toHistoryCategories(rows: CategoryWithRelations[]): HistoryCategory[] {
    return rows.map((cat) => ({
        id: cat.id,
        name: cat.name,
        isLiability: !!cat.isLiability,
        isCash: !!cat.isCash,
        parentId: cat.parentId,
        tags: cat.tags.map((t) => ({
            tagGroupId: t.tagGroupId,
            tagOption: t.tagOption ? { name: t.tagOption.name } : null,
        })),
        transactions: cat.transactions,
    }))
}

export type FinancialSnapshot = {
    categories: (ReturnType<typeof mapCategoriesFromRows>[number] & { purpose: AccountPurpose })[]
    historyPoints: HistoryPoint[]
    /** 投資用途のカテゴリだけで計算した履歴。投資資産の画面はこれを使い、カテゴリ・損益と母集団を揃える（#965） */
    investmentHistoryPoints: HistoryPoint[]
}

const EMPTY_SNAPSHOT: FinancialSnapshot = { categories: [], historyPoints: [], investmentHistoryPoints: [] }

async function loadFinancialSnapshot(userId: string): Promise<FinancialSnapshot> {
    const [allCategories, historyRecords, accounts] = await Promise.all([
        prisma.category.findMany({
            where: { userId },
            include: categoryInclude,
        }) as Promise<CategoryWithRelations[]>,
        prisma.asset.findMany({
            where: { userId },
            orderBy: { recordedAt: "asc" },
            select: {
                categoryId: true,
                currentValue: true,
                recordedAt: true,
            },
        }),
        prisma.ledgerAccount.findMany({
            where: { userId },
            select: { id: true, purpose: true, hidden: true, order: true },
        }),
    ])

    if (!allCategories.length) {
        return EMPTY_SNAPSHOT
    }

    const purposes = resolveCategoryPurposes(
        allCategories.map((c) => ({
            id: c.id,
            parentId: c.parentId,
            isCash: !!c.isCash,
            isLiability: !!c.isLiability,
            excludeFromInvestmentView: !!c.excludeFromInvestmentView,
            ledgerAccountId: c.ledgerAccountId,
        })),
        accounts,
    )
    const categories = mapCategoriesFromRows(allCategories).map((c) => ({
        ...c,
        purpose: purposes.get(c.id) ?? ("INVESTMENT" as const),
    }))
    const historyPoints = computeHistoryPoints(
        historyRecords,
        toHistoryCategories(allCategories),
    )
    const investmentRows = allCategories.filter((c) => purposes.get(c.id) === "INVESTMENT")
    const investmentIds = new Set(investmentRows.map((c) => c.id))
    const investmentHistoryPoints = computeHistoryPoints(
        historyRecords.filter((r) => investmentIds.has(r.categoryId)),
        toHistoryCategories(investmentRows),
    )

    return { categories, historyPoints, investmentHistoryPoints }
}

function getCachedFinancialSnapshot(userId: string) {
    return unstable_cache(
        () => loadFinancialSnapshot(userId),
        ["financial-snapshot", userId],
        { revalidate: 300, tags: [dashboardCacheTag(userId)] },
    )
}

/** 1リクエスト内でカテゴリ・履歴の DB 取得と計算を1回にまとめる */
export const getFinancialSnapshot = cache(async (): Promise<FinancialSnapshot> => {
    const userId = await getCurrentUserId()
    if (!userId) {
        return EMPTY_SNAPSHOT
    }

    try {
        return await getCachedFinancialSnapshot(userId)()
    } catch (error) {
        console.error("[getFinancialSnapshot] Error:", error)
        return EMPTY_SNAPSHOT
    }
})
