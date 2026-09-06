import { getCalendarDayKey, getJstDayBounds } from "@/lib/valuation-day"

export interface HistoryPoint {
    date: string
    totalAssets: number | null
    totalCost: number | null
    [key: string]: string | number | null
}

export interface HistoryTransaction {
    transactedAt: Date | string
    amount: number
    type: string
    realizedGain: number | null
}

export interface HistoryCategory {
    id: number
    name: string
    isLiability: boolean
    isCash: boolean
    parentId: number | null
    tags: { tagGroupId: number; tagOption: { name: string } | null }[]
    transactions: HistoryTransaction[]
}

export interface HistoryAssetRecord {
    categoryId: number
    currentValue: number
    recordedAt: Date | string
}

function netFlowFromTransactions(transactions: HistoryTransaction[]): number {
    return transactions.reduce((sum, t) => {
        const amt = Number(t.amount)
        if (t.type === "DEPOSIT") return sum + amt
        if (t.type === "WITHDRAW") return sum - amt
        return sum
    }, 0)
}

/** 履歴グラフ用ポイントを生成する（日付×カテゴリの全件スキャンを避ける実装） */
export function computeHistoryPoints(
    historyRecords: HistoryAssetRecord[],
    categories: HistoryCategory[],
): HistoryPoint[] {
    if (!historyRecords.length || !categories.length) return []

    const dateSet = new Set<string>()
    for (const record of historyRecords) {
        dateSet.add(getCalendarDayKey(new Date(record.recordedAt)))
    }
    for (const cat of categories) {
        for (const tx of cat.transactions || []) {
            dateSet.add(getCalendarDayKey(new Date(tx.transactedAt)))
        }
    }
    const sortedDates = Array.from(dateSet).sort()

    const childrenMap = new Map<number, number[]>()
    const categoryMap = new Map<number, HistoryCategory>()
    for (const cat of categories) {
        categoryMap.set(cat.id, cat)
        if (cat.parentId) {
            const siblings = childrenMap.get(cat.parentId) || []
            siblings.push(cat.id)
            childrenMap.set(cat.parentId, siblings)
        }
    }

    const effectiveTagCache = new Map<number, { name: string; groupId: number }[]>()
    const getEffectiveTags = (id: number): { name: string; groupId: number }[] => {
        if (effectiveTagCache.has(id)) return effectiveTagCache.get(id)!
        const cat = categoryMap.get(id)
        if (!cat) return []
        let tags = (cat.tags || [])
            .map((t) => ({
                name: (t.tagOption?.name || "").trim(),
                groupId: t.tagGroupId,
            }))
            .filter((t) => t.name)
        if (tags.length === 0 && cat.parentId) {
            tags = getEffectiveTags(cat.parentId)
        }
        effectiveTagCache.set(id, tags)
        return tags
    }

    const latestValues = new Map<number, number>()
    const latestCostBasis = new Map<number, number>()
    const latestRealizedGain = new Map<number, number>()

    const getConsolidated = (
        id: number,
        valSource: Map<number, number>,
        costSource: Map<number, number>,
        visited = new Set<number>(),
    ): { val: number; cost: number } => {
        if (visited.has(id)) return { val: 0, cost: 0 }
        visited.add(id)

        const cat = categoryMap.get(id)
        if (!cat) return { val: 0, cost: 0 }

        let val = valSource.get(id) || 0
        let cost = costSource.get(id) || 0

        for (const childId of childrenMap.get(id) || []) {
            const res = getConsolidated(childId, valSource, costSource, visited)
            val += res.val
            cost += res.cost
        }

        return { val, cost }
    }

    const getConsolidatedRealizedGain = (
        id: number,
        source: Map<number, number>,
        visited = new Set<number>(),
    ): number => {
        if (visited.has(id)) return 0
        visited.add(id)

        const cat = categoryMap.get(id)
        if (!cat) return 0

        let total = source.get(id) || 0
        for (const childId of childrenMap.get(id) || []) {
            total += getConsolidatedRealizedGain(childId, source, visited)
        }
        return total
    }

    const txsByCatDate = new Map<number, Map<string, HistoryTransaction[]>>()
    const sortedTxsByCat = new Map<number, HistoryTransaction[]>()
    const txPtrByCat = new Map<number, number>()
    const runningCostByCat = new Map<number, number>()
    const runningRealizedByCat = new Map<number, number>()

    for (const cat of categories) {
        const txs = (cat.transactions || [])
            .map((t) => ({
                ...t,
                transactedAt: new Date(t.transactedAt),
                amount: Number(t.amount),
            }))
            .sort((a, b) => a.transactedAt.getTime() - b.transactedAt.getTime())

        sortedTxsByCat.set(cat.id, txs)
        txPtrByCat.set(cat.id, 0)
        runningCostByCat.set(cat.id, 0)
        runningRealizedByCat.set(cat.id, 0)

        const byDate = new Map<string, HistoryTransaction[]>()
        for (const tx of txs) {
            const dayKey = getCalendarDayKey(tx.transactedAt)
            const bucket = byDate.get(dayKey) || []
            bucket.push(tx)
            byDate.set(dayKey, bucket)
        }
        txsByCatDate.set(cat.id, byDate)
    }

    const valuationsOnDate = new Map<string, { categoryId: number; value: number }[]>()
    for (const record of historyRecords) {
        const dayKey = getCalendarDayKey(new Date(record.recordedAt))
        const bucket = valuationsOnDate.get(dayKey) || []
        bucket.push({ categoryId: record.categoryId, value: Number(record.currentValue) })
        valuationsOnDate.set(dayKey, bucket)
    }

    const allTagKeys = new Set<string>()
    const categoryTagContributions: { tags: { name: string; groupId: number }[] }[] = []

    for (const cat of categories) {
        const tags = getEffectiveTags(cat.id)
        for (const tag of tags) {
            allTagKeys.add(`tag_${tag.groupId}_${tag.name}`)
        }
        const uniqueTagsMap = new Map<string, { name: string; groupId: number }>()
        for (const tag of tags) {
            uniqueTagsMap.set(`${tag.groupId}_${tag.name}`, tag)
        }
        categoryTagContributions.push({
            tags: [...uniqueTagsMap.values()],
        })
    }

    const topLevelCategories = categories.filter((cat) => !cat.parentId)

    const points: HistoryPoint[] = []

    for (const dateStr of sortedDates) {
        const { end: dayEnd } = getJstDayBounds(dateStr)

        for (const cat of categories) {
            const txsToday = txsByCatDate.get(cat.id)?.get(dateStr) || []
            if (txsToday.length > 0) {
                const prevVal = latestValues.get(cat.id) || 0
                latestValues.set(cat.id, Math.max(0, prevVal + netFlowFromTransactions(txsToday)))
            }
        }

        for (const valuation of valuationsOnDate.get(dateStr) || []) {
            latestValues.set(valuation.categoryId, valuation.value)
        }

        for (const cat of categories) {
            // 負債も現金と同じく損益を持たない（原価＝評価額）。#344
            if (cat.isCash || cat.isLiability) {
                latestCostBasis.set(cat.id, latestValues.get(cat.id) || 0)
            }

            const txs = sortedTxsByCat.get(cat.id) || []
            let ptr = txPtrByCat.get(cat.id) || 0
            let cost = runningCostByCat.get(cat.id) || 0
            let realized = runningRealizedByCat.get(cat.id) || 0

            while (ptr < txs.length && txs[ptr].transactedAt <= dayEnd) {
                const tx = txs[ptr]
                if (!cat.isCash) {
                    if (tx.type === "DEPOSIT") cost += tx.amount
                    else if (tx.type === "WITHDRAW") cost -= tx.amount
                }
                realized += Number(tx.realizedGain || 0)
                ptr++
            }

            txPtrByCat.set(cat.id, ptr)
            runningCostByCat.set(cat.id, cost)
            runningRealizedByCat.set(cat.id, realized)

            if (!cat.isCash && !cat.isLiability) {
                latestCostBasis.set(cat.id, cost)
            }
            latestRealizedGain.set(cat.id, realized)
        }

        const point: HistoryPoint = {
            date: dateStr,
            totalAssets: 0,
            totalCost: 0,
            timestamp: dayEnd.getTime(),
        }
        for (const key of allTagKeys) {
            point[key] = 0
        }

        for (let catIndex = 0; catIndex < categories.length; catIndex++) {
            const cat = categories[catIndex]
            // 負債はタグ軸の構成比に混ぜない（マイナスの評価額で他のタグを打ち消してしまう）。#344
            if (cat.isLiability) continue
            const val = latestValues.get(cat.id) || 0
            const cost = latestCostBasis.get(cat.id) || 0
            const realizedGain = latestRealizedGain.get(cat.id) || 0

            for (const tag of categoryTagContributions[catIndex].tags) {
                const key = `tag_${tag.groupId}_${tag.name}`
                const costKey = `tag_cost_${tag.groupId}_${tag.name}`
                const realizedKey = `tag_realized_gain_${tag.groupId}_${tag.name}`
                point[key] = (Number(point[key]) || 0) + val
                point[costKey] = (Number(point[costKey]) || 0) + cost
                point[realizedKey] = (Number(point[realizedKey]) || 0) + realizedGain
            }
        }

        let grossAssets = 0
        let totalCost = 0
        let totalRealizedGain = 0
        // 負債の評価額はマイナスで持つ（lib/asset-breakdown.ts）。合計は正の値に直して持ち回る。
        let totalLiabilities = 0

        for (const cat of topLevelCategories) {
                const res = getConsolidated(cat.id, latestValues, latestCostBasis)
                const realized = getConsolidatedRealizedGain(cat.id, latestRealizedGain)
                point[`category_${cat.id}`] = res.val
                point[`category_cost_${cat.id}`] = Math.max(0, res.cost)
                point[`realized_gain_${cat.id}`] = realized

                // 負債は「評価額」「取得額」の系列には足さない。純資産としてだけ差し引く。#344
                if (cat.isLiability) {
                    totalLiabilities -= res.val
                    continue
                }

                grossAssets += res.val
                totalCost += Math.max(0, res.cost)
                totalRealizedGain += realized
        }

        point.totalAssets = grossAssets
        point.totalCost = totalCost
        point.totalLiabilities = totalLiabilities
        point.netWorth = grossAssets - totalLiabilities
        point.totalRealizedGain = totalRealizedGain

        for (const key of Object.keys(point)) {
            if (key.startsWith("tag_") && Number(point[key]) < 0) {
                point[key] = 0
            }
        }

        points.push(point)
    }

    return points
}
