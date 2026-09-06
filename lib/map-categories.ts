import {
    findAssetOnOrBefore,
    sumCostBasis,
    sumNetFlowInRange,
    sumRealizedGain,
} from "@/lib/category-metrics"

export interface CategoryWithRelations {
    id: number
    name: string
    color: string | null
    order: number
    valuationOrder: number | null
    isValuationTarget: boolean | null
    valuationAlias: string | null
    hidden: boolean
    parentId: number | null
    isCash: boolean | null
    isLiability: boolean | null
    assets: { currentValue: number; recordedAt: Date }[]
    tags: {
        tagGroupId: number
        tagGroup: { name: string }
        tagOptionId: number | null
        tagOption: { name: string } | null
    }[]
    transactions: {
        amount: number
        type: string
        transactedAt: Date
        realizedGain: number | null
    }[]
}

export function mapCategoriesFromRows(allCategories: CategoryWithRelations[]) {
    if (!allCategories.length) return []

    const sorted: (CategoryWithRelations & { depth: number })[] = []
    const processLevel = (parentId: number | null, depth: number) => {
        const levelItems = allCategories
            .filter((c) => c.parentId === parentId)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

        levelItems.forEach((item) => {
            sorted.push({ ...item, depth })
            processLevel(item.id, depth + 1)
        })
    }

    processLevel(null, 0)

    const mappedCategories = sorted.map((cat) => {
        const latestAsset = cat.assets.length > 0 ? cat.assets[0] : null
        const prevAsset = cat.assets.length > 1 ? cat.assets[1] : null
        const ownValue = Number(latestAsset?.currentValue || 0)

        const hasDailyComparison = !!latestAsset && !!prevAsset
        const ownDailyValueChange = hasDailyComparison
            ? Number(latestAsset.currentValue) - Number(prevAsset.currentValue)
            : 0
        const dailyNetFlow = hasDailyComparison
            ? sumNetFlowInRange(cat.transactions, prevAsset.recordedAt, latestAsset.recordedAt)
            : 0
        const ownDailyChange = hasDailyComparison ? ownDailyValueChange - dailyNetFlow : undefined

        const ownDailyChangeDays = hasDailyComparison
            ? Math.max(
                  1,
                  Math.round(
                      (latestAsset.recordedAt.getTime() - prevAsset.recordedAt.getTime()) /
                          (1000 * 60 * 60 * 24),
                  ),
              )
            : undefined
        const prevValue = Number(prevAsset?.currentValue || 0)
        const ownDailyChangeRate = hasDailyComparison
            ? prevValue > 0
                ? ((ownDailyChange ?? 0) / prevValue) * 100
                : 0
            : undefined

        const thirtyDaysAgoLimit = latestAsset
            ? new Date(latestAsset.recordedAt.getTime() - 30 * 24 * 60 * 60 * 1000)
            : null
        const monthAgoAsset = thirtyDaysAgoLimit
            ? findAssetOnOrBefore(cat.assets, thirtyDaysAgoLimit)
            : null

        const hasMonthlyComparison = !!latestAsset && !!monthAgoAsset
        const ownMonthlyValueChange = hasMonthlyComparison
            ? Number(latestAsset.currentValue) - Number(monthAgoAsset.currentValue)
            : 0
        const monthlyNetFlow = hasMonthlyComparison
            ? sumNetFlowInRange(cat.transactions, monthAgoAsset.recordedAt, latestAsset.recordedAt)
            : 0
        const ownMonthlyChange = hasMonthlyComparison
            ? ownMonthlyValueChange - monthlyNetFlow
            : undefined

        const ownMonthlyChangeDays = hasMonthlyComparison
            ? Math.max(
                  1,
                  Math.round(
                      (latestAsset.recordedAt.getTime() - monthAgoAsset.recordedAt.getTime()) /
                          (1000 * 60 * 60 * 24),
                  ),
              )
            : undefined
        const monthAgoValue = Number(monthAgoAsset?.currentValue || 0)
        const ownMonthlyChangeRate = hasMonthlyComparison
            ? monthAgoValue > 0
                ? ((ownMonthlyChange ?? 0) / monthAgoValue) * 100
                : 0
            : undefined

        const shouldHideMonthlyBecauseOverlap = (ownDailyChangeDays ?? 0) >= 30
        const finalMonthlyChange = shouldHideMonthlyBecauseOverlap ? undefined : ownMonthlyChange
        const finalMonthlyChangeDays = shouldHideMonthlyBecauseOverlap
            ? undefined
            : ownMonthlyChangeDays
        const finalMonthlyChangeRate = shouldHideMonthlyBecauseOverlap
            ? undefined
            : ownMonthlyChangeRate

        const trxs = cat.transactions
        const ownRealizedGain = sumRealizedGain(trxs)
        const ownCostBasis = sumCostBasis(trxs, !!cat.isCash, ownValue)

        return {
            ...cat,
            ownValue,
            ownCostBasis,
            ownRealizedGain,
            ownDailyChange: ownDailyChange ?? 0,
            currentValue: ownValue,
            costBasis: ownCostBasis,
            realizedGain: ownRealizedGain,
            dailyChange: ownDailyChange ?? 0,
            dailyChangeRate: ownDailyChangeRate ?? 0,
            dailyChangeDays: ownDailyChangeDays,
            monthlyChange: finalMonthlyChange ?? 0,
            monthlyChangeRate: finalMonthlyChangeRate ?? 0,
            monthlyChangeDays: finalMonthlyChangeDays,
            lastUpdated: latestAsset?.recordedAt || undefined,
        }
    })

    const parentIdsWithChildren = new Set(
        mappedCategories
            .filter((cat) => cat.parentId !== null && cat.parentId !== undefined)
            .map((cat) => cat.parentId as number),
    )

    mappedCategories.forEach((cat) => {
        if (parentIdsWithChildren.has(cat.id)) {
            cat.ownValue = 0
            cat.ownCostBasis = 0
            cat.ownDailyChange = 0
            cat.currentValue = 0
            cat.costBasis = 0
            cat.ownRealizedGain = 0
            cat.realizedGain = 0
            cat.dailyChange = 0
            cat.monthlyChange = 0
        }
    })

    const categoryById = new Map(mappedCategories.map((cat) => [cat.id, cat]))
    const depthSorted = [...mappedCategories].sort((a, b) => b.depth - a.depth)

    depthSorted.forEach((item) => {
        if (!item.parentId) return
        const parent = categoryById.get(item.parentId)
        if (!parent) return
        parent.currentValue += item.currentValue
        parent.dailyChange += item.dailyChange
        parent.monthlyChange += item.monthlyChange
        parent.costBasis += item.costBasis
        parent.realizedGain += item.realizedGain
        if (
            item.lastUpdated &&
            (!parent.lastUpdated || item.lastUpdated > parent.lastUpdated)
        ) {
            parent.lastUpdated = item.lastUpdated
        }
    })

    mappedCategories.forEach((cat) => {
        const prevDayVal = cat.currentValue - cat.dailyChange
        cat.dailyChangeRate = prevDayVal > 0 ? (cat.dailyChange / prevDayVal) * 100 : 0

        const prevMonthVal = cat.currentValue - cat.monthlyChange
        cat.monthlyChangeRate = prevMonthVal > 0 ? (cat.monthlyChange / prevMonthVal) * 100 : 0
    })

    return mappedCategories.map((cat) => ({
        id: cat.id,
        name: cat.name || "名称なし",
        color: cat.color || "#cccccc",
        order: cat.order || 0,
        valuationOrder: cat.valuationOrder ?? 0,
        isValuationTarget: cat.isValuationTarget ?? true,
        valuationAlias: cat.valuationAlias ?? null,
        parentId: cat.parentId,
        currentValue: cat.currentValue,
        costBasis: cat.costBasis,
        ownValue: cat.ownValue,
        ownCostBasis: cat.ownCostBasis,
        realizedGain: cat.realizedGain,
        dailyChange: cat.dailyChange,
        dailyChangeRate: cat.dailyChangeRate,
        dailyChangeDays: cat.dailyChangeDays,
        monthlyChange: cat.monthlyChange,
        monthlyChangeRate: cat.monthlyChangeRate,
        monthlyChangeDays: cat.monthlyChangeDays,
        lastUpdated: cat.lastUpdated,
        hidden: !!cat.hidden,
        isCash: !!cat.isCash,
        isLiability: !!cat.isLiability,
        depth: cat.depth,
        tags: cat.tags.map((t) => t.tagOption?.name || ""),
        tagSettings: cat.tags.map((t) => ({
            groupId: t.tagGroupId,
            groupName: t.tagGroup?.name || "",
            optionId: t.tagOptionId,
            optionName: t.tagOption?.name || "",
        })),
    }))
}
