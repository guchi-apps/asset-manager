import { prisma } from "@/lib/prisma"
import { normalizeRecordDate } from "@/lib/valuation-day"
import { upsertValuationChange } from "@/lib/valuation-change"
import { scrapeZaimBalances, toMatchKey } from "@/lib/zaim-scraper"

export interface ZaimSyncResult {
    updated: number
    skipped: number
    unmatched: string[]
}

export async function syncZaimValuations(userId: string, recordedAt = new Date()): Promise<ZaimSyncResult> {
    const balances = await scrapeZaimBalances()
    const categories = await prisma.category.findMany({
        where: {
            userId,
            isValuationTarget: true,
        },
        select: {
            id: true,
            name: true,
            valuationAlias: true,
        },
    })

    // Zaim側の名称はDOM分割で空白・改行が混ざるため、空白を除去したキーで照合する。
    const aliasMap = new Map<string, number>()
    for (const category of categories) {
        const alias = toMatchKey(category.valuationAlias ?? "")
        if (alias && !aliasMap.has(alias)) aliasMap.set(alias, category.id)
    }

    let updated = 0
    let skipped = 0
    const unmatched: string[] = []
    const normalizedDate = normalizeRecordDate(recordedAt)

    for (const balance of balances) {
        const categoryId = aliasMap.get(toMatchKey(balance.name))
        if (!categoryId) {
            unmatched.push(balance.name)
            continue
        }

        const result = await upsertValuationChange({
            categoryId,
            userId,
            date: normalizedDate,
            value: balance.amount,
            confirmOverwrite: true,
            createTransaction: false,
        })

        if ("needsConfirmation" in result || !result.success) {
            skipped += 1
            continue
        }

        updated += 1
    }

    return { updated, skipped, unmatched }
}
