import { prisma } from "@/lib/prisma"
import { normalizeRecordDate } from "@/lib/valuation-day"
import { upsertValuationChange } from "@/lib/valuation-change"
import { scrapeZaimSnapshot, toMatchKey } from "@/lib/zaim-scraper"
import { matchZaimSnapshot } from "@/lib/zaim-match"

export interface ZaimSyncEntry {
    categoryId: number
    categoryName: string
    /** 反映元となったZaim側の名称（複数一致した場合は合算元をすべて含む） */
    sources: string[]
    amount: number
}

export interface ZaimSyncResult {
    updated: number
    skipped: number
    unmatched: string[]
    entries: ZaimSyncEntry[]
    dryRun: boolean
}

export interface ZaimSyncOptions {
    recordedAt?: Date
    /** trueの場合はDBへ書き込まず、対応付け結果だけを返す */
    dryRun?: boolean
}

/** valuationAlias は「,」「、」「|」区切りで複数の名称を設定できる。 */
function splitAliases(valuationAlias: string | null): string[] {
    if (!valuationAlias) return []
    return valuationAlias
        .split(/[,、|]/)
        .map((alias) => toMatchKey(alias))
        .filter(Boolean)
}

export async function syncZaimValuations(
    userId: string,
    options: ZaimSyncOptions = {}
): Promise<ZaimSyncResult> {
    const { recordedAt = new Date(), dryRun = false } = options

    const snapshot = await scrapeZaimSnapshot()
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

    const categoryByAliasKey = new Map<string, (typeof categories)[number]>()
    for (const category of categories) {
        for (const aliasKey of splitAliases(category.valuationAlias)) {
            if (!categoryByAliasKey.has(aliasKey)) categoryByAliasKey.set(aliasKey, category)
        }
    }

    const { matched, unmatched } = matchZaimSnapshot(snapshot, categoryByAliasKey.keys())

    // 1つのカテゴリに複数のaliasを設定して複数一致した場合は、
    // どれか1つだけ反映して残りを捨てないよう合算する。
    const entryByCategoryId = new Map<number, ZaimSyncEntry>()
    for (const item of matched) {
        const category = categoryByAliasKey.get(item.aliasKey)
        if (!category) continue

        const current = entryByCategoryId.get(category.id)
        if (current) {
            current.amount += item.amount
            current.sources.push(item.name)
            continue
        }
        entryByCategoryId.set(category.id, {
            categoryId: category.id,
            categoryName: category.name,
            sources: [item.name],
            amount: item.amount,
        })
    }

    const entries = [...entryByCategoryId.values()]
    if (dryRun) {
        return { updated: 0, skipped: 0, unmatched, entries, dryRun: true }
    }

    let updated = 0
    let skipped = 0
    const normalizedDate = normalizeRecordDate(recordedAt)

    for (const entry of entries) {
        const result = await upsertValuationChange({
            categoryId: entry.categoryId,
            userId,
            date: normalizedDate,
            value: entry.amount,
            confirmOverwrite: true,
            createTransaction: false,
        })

        if ("needsConfirmation" in result || !result.success) {
            skipped += 1
            continue
        }

        updated += 1
    }

    return { updated, skipped, unmatched, entries, dryRun: false }
}
