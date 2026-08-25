import { prisma } from "@/lib/prisma"
import { normalizeRecordDate } from "@/lib/valuation-day"
import {
    findLatestValuationBefore,
    findValuationChangeForDay,
    upsertValuationChange,
} from "@/lib/valuation-change"
import { fetchZaimSnapshotFromAide } from "@/lib/zaim-aide"
import type { ZaimFreshness } from "@/lib/zaim-freshness"
import { resolveZaimEntries, type ZaimResolvedEntry } from "@/lib/zaim-match"
import { getZaimAllowedEmails } from "@/lib/zaim-access"
import { decideZaimAutoSave, type ZaimSkipReason } from "@/lib/zaim-sync-policy"

/**
 * 画面を経由しない実行（定期実行・HTTP API）の同期対象ユーザーを引く。
 *
 * `ZAIM_SYNC_USER_EMAIL` は「,」区切りで複数指定できるため、値をそのまま1件の
 * メールアドレスとして扱うと、複数指定した環境で対象が見つからず毎回失敗する。
 * 先に書かれたアドレスを優先し、大文字小文字・前後の空白は `getZaimAllowedEmails` が吸収する。
 */
export async function findZaimSyncUser(): Promise<{ id: string } | null> {
    const allowedEmails = getZaimAllowedEmails()
    if (allowedEmails.length === 0) return null

    const users = await prisma.user.findMany({
        where: { email: { in: allowedEmails } },
        select: { id: true, email: true },
    })

    for (const email of allowedEmails) {
        const user = users.find((candidate) => candidate.email?.trim().toLowerCase() === email)
        if (user) return { id: user.id }
    }

    return null
}

export type ZaimSyncEntry = ZaimResolvedEntry

export interface ZaimSyncSkippedEntry {
    categoryId: number
    categoryName: string
    /** 保存しなかった金額 */
    amount: number
    /** 比較の基準にした直近の評価額。無ければ null */
    baselineValue: number | null
    reason: ZaimSkipReason
}

export interface ZaimSyncResult {
    updated: number
    skipped: number
    /** 保存しなかった項目とその理由 */
    skippedEntries: ZaimSyncSkippedEntry[]
    unmatched: string[]
    entries: ZaimSyncEntry[]
    dryRun: boolean
    /** 取得結果がいつのものか。AIDEは日次で巡回するため、押した瞬間の値ではない。 */
    freshness: ZaimFreshness
}

export interface ZaimSyncOptions {
    recordedAt?: Date
    /** trueの場合はDBへ書き込まず、対応付け結果だけを返す */
    dryRun?: boolean
    /**
     * その日の評価額がすでにある場合に上書きするか。
     * 画面・APIからの実行は利用者が結果を確認できるためtrue、定期実行では手動入力を
     * 勝手に書き換えないようfalseで呼ぶ。
     */
    overwriteExisting?: boolean
    /** 直近の評価額から大きく離れた値（±50%超）を保存せずスキップするか */
    detectLargeDiff?: boolean
}

export async function syncZaimValuations(
    userId: string,
    options: ZaimSyncOptions = {}
): Promise<ZaimSyncResult> {
    const {
        recordedAt = new Date(),
        dryRun = false,
        overwriteExisting = true,
        detectLargeDiff = false,
    } = options

    const { snapshot, ...freshness } = await fetchZaimSnapshotFromAide()
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
        return {
            updated: 0,
            skipped: 0,
            skippedEntries: [],
            unmatched,
            entries,
            dryRun: true,
            freshness,
        }
    }

    let updated = 0
    const skippedEntries: ZaimSyncSkippedEntry[] = []
    const normalizedDate = normalizeRecordDate(recordedAt)

    for (const entry of entries) {
        const existing = await findValuationChangeForDay(entry.categoryId, normalizedDate, userId)
        const hasValueToday = Boolean(existing?.assetId)
        // 当日分があればそれを、無ければ前日以前の直近を変動判定の基準にする。
        const baselineValue = hasValueToday
            ? existing!.value
            : await findLatestValuationBefore(entry.categoryId, normalizedDate, userId)

        const decision = decideZaimAutoSave({
            hasValueToday,
            baselineValue,
            amount: entry.amount,
            overwriteExisting,
            detectLargeDiff,
        })

        if (decision.action === "skip") {
            skippedEntries.push({
                categoryId: entry.categoryId,
                categoryName: entry.categoryName,
                amount: entry.amount,
                baselineValue,
                reason: decision.reason,
            })
            continue
        }

        const result = await upsertValuationChange({
            categoryId: entry.categoryId,
            userId,
            date: normalizedDate,
            value: entry.amount,
            confirmOverwrite: true,
            createTransaction: false,
        })

        if ("needsConfirmation" in result || !result.success) {
            skippedEntries.push({
                categoryId: entry.categoryId,
                categoryName: entry.categoryName,
                amount: entry.amount,
                baselineValue,
                reason: "writeFailed",
            })
            continue
        }

        updated += 1
    }

    return {
        updated,
        skipped: skippedEntries.length,
        skippedEntries,
        unmatched,
        entries,
        dryRun: false,
        freshness,
    }
}
