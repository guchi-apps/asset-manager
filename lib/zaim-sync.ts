import { prisma } from "@/lib/prisma"
import { normalizeRecordDate } from "@/lib/valuation-day"
import { upsertValuationChange } from "@/lib/valuation-change"
import { scrapeZaimSnapshot } from "@/lib/zaim-scraper"
import { resolveZaimEntries, type ZaimResolvedEntry } from "@/lib/zaim-match"

export type ZaimSyncEntry = ZaimResolvedEntry

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

    const { entries, unmatched } = resolveZaimEntries(categories, snapshot)

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
