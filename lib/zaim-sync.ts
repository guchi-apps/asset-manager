import { prisma } from "@/lib/prisma"
import { getCalendarDayKey, parseValuationDateInput } from "@/lib/valuation-day"
import {
    findLatestValuationBefore,
    findValuationChangeForDay,
    upsertValuationChange,
} from "@/lib/valuation-change"
import { fetchZaimSnapshotFromAide } from "@/lib/zaim-aide"
import {
    isStaleForDay,
    resolveEntryRecordDayKey,
    resolveZaimRecordedAt,
    type ZaimFreshness,
} from "@/lib/zaim-freshness"
import { holdingRowName, resolveZaimEntries, type ZaimResolvedEntry } from "@/lib/zaim-match"
import { getZaimAllowedEmails } from "@/lib/zaim-access"
import {
    canOverwriteRecordDay,
    decideZaimAutoSave,
    type ZaimSkipReason,
} from "@/lib/zaim-sync-policy"

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

export type ZaimSyncEntry = ZaimResolvedEntry & {
    /**
     * この項目を「いつの評価額」として記録するか（JSTの `YYYY-MM-DD`）。
     * 反映元の最終更新が巡回日より前なら、その日へ書き戻す（#258）。
     */
    recordDayKey: string
}

export interface ZaimSyncSkippedEntry {
    categoryId: number
    categoryName: string
    /** 保存しなかった金額 */
    amount: number
    /** 保存しようとした記録日（JSTの `YYYY-MM-DD`）。項目ごとに違う。 */
    recordDayKey: string
    /** 比較の基準にした直近の評価額。無ければ null */
    baselineValue: number | null
    /** 反映元のZaim口座の最終更新（ISO8601）。連携していない口座は null */
    lastUpdatedAt: string | null
    reason: ZaimSkipReason
}

/**
 * 実際に保存できた項目（Issue #269）。
 *
 * 件数だけでは「何が反映されたのか」を後から画面に出せないため、保存した行を
 * 比較の基準にした値つきで残す。**保存の可否には関与しない記録用の情報。**
 */
export interface ZaimSyncSavedEntry {
    categoryId: number
    categoryName: string
    /** 保存した金額 */
    amount: number
    /** 保存した記録日（JSTの `YYYY-MM-DD`） */
    recordDayKey: string
    /** 保存する前に記録されていた評価額。初めての記録なら null */
    baselineValue: number | null
    /** 反映元のZaim表示名 */
    sources: string[]
}

/**
 * どのカテゴリにも対応付かなかったZaim側の項目（Issue #269）。
 * 画面で「表示設定に登録すれば反映される」と案内するために金額まで持つ。
 */
export interface ZaimSyncUnmatchedEntry {
    /** `valuationAlias` にそのまま貼れる表記 */
    name: string
    /** 取得結果に載っていた金額。名称から引けなければ null */
    amount: number | null
}

export interface ZaimSyncResult {
    updated: number
    skipped: number
    /** 保存しなかった項目とその理由 */
    skippedEntries: ZaimSyncSkippedEntry[]
    /** 保存できた項目。記録・表示のためだけに返す */
    savedEntries: ZaimSyncSavedEntry[]
    unmatched: string[]
    /** `unmatched` と同じ項目に、取得結果の金額を添えたもの */
    unmatchedEntries: ZaimSyncUnmatchedEntry[]
    entries: ZaimSyncEntry[]
    dryRun: boolean
    /**
     * AIDEが巡回した日（JSTの `YYYY-MM-DD`）。**全項目の記録日ではない。**
     * 更新の遅い連携口座は前日ぶんとして書き戻すため、実際の記録日は
     * 項目ごとの `recordDayKey` を見る（#258）。
     */
    recordDayKey: string
    /** 取得結果がいつのものか。AIDEは日次で巡回するため、押した瞬間の値ではない。 */
    freshness: ZaimFreshness
    /**
     * 取得結果が古い・空だったため、何も保存せずに終えた。
     * `requireFresh` を付けた実行（定期実行）でだけ true になりうる。
     */
    staleSkipped: boolean
}

export interface ZaimSyncOptions {
    /**
     * 記録日を明示する。指定した場合は**全項目をその日へ**記録し、書き戻しを行わない。
     *
     * 省略した場合の基準は**AIDEが巡回した時刻（`fetchedAt`）のJST日**で、そこから
     * 項目ごとに `resolveEntryRecordDayKey` で記録日を決める。
     * 実行時刻で決めてはいけない（#254）。PM2の `cron_restart` はデプロイのたびに
     * 定期実行を1回起動するため、日中のデプロイでは前夜23:35の巡回結果を読むことになる。
     * 実行時刻で日付を決めると、その中身（前日の残高）が当日の評価額として記録される。
     */
    recordedAt?: Date
    /** trueの場合はDBへ書き込まず、対応付け結果だけを返す */
    dryRun?: boolean
    /**
     * その日の評価額がすでにある場合に上書きするか。
     * 画面・APIからの実行は利用者が結果を確認できるためtrueで呼ぶ。
     */
    overwriteExisting?: boolean
    /**
     * 記録日が実行日（JST）と同じ場合にかぎり上書きするか。定期実行はこれをtrueで呼ぶ。
     *
     * 毎晩23:50の本実行は当日の巡回結果を当日へ書くため上書きが効き、誤った値が入っても
     * その晩に直る。一方デプロイ直後の1回実行は前夜の巡回結果を**前日**へ書こうとするので、
     * 前日に手動で直した値を書き戻さない。
     *
     * **書き戻し（記録日が巡回日より前）はこの制限を受けない。** その項目については
     * Zaimがその日の確定値を持っており、いま入っている値のほうが確実に古いため（#258）。
     */
    overwriteTodayOnly?: boolean
    /** 直近の評価額から大きく離れた値（±50%超）を保存せずスキップするか */
    detectLargeDiff?: boolean
    /**
     * 反映元のZaim口座の最終更新が記録日より前の項目を、保存せずスキップするか。
     *
     * 連携口座は更新ボタンを押しても金融機関側の都合で当日にならないことがある。
     * その残高を記録日の評価額として保存すると前日の値がそのまま入り、前日比の差が
     * 小さいため±50%の検知にも掛からない。定期実行では必ずtrueで呼ぶ。
     */
    detectStaleSource?: boolean
    /**
     * AIDEの巡回結果が古い（24時間超）・まだ無い場合に、何も保存せず終えるか。
     *
     * **巡回が止まっていてもAIDEは200を返す。** 中身は前回巡回時の値のままなので、
     * 記録日を巡回時刻から決めていても、何日も前の日付へ黙って書き足すことになる。
     * 目視で確認する人がいない定期実行では必ずtrueで呼ぶ。
     */
    requireFresh?: boolean
}

export async function syncZaimValuations(
    userId: string,
    options: ZaimSyncOptions = {}
): Promise<ZaimSyncResult> {
    const {
        dryRun = false,
        overwriteExisting = true,
        overwriteTodayOnly = false,
        detectLargeDiff = false,
        detectStaleSource = false,
        requireFresh = false,
    } = options

    const { snapshot, ...freshness } = await fetchZaimSnapshotFromAide()
    const now = new Date()
    const recordedAt = options.recordedAt ?? resolveZaimRecordedAt(freshness.fetchedAt, now)
    const recordDayKey = getCalendarDayKey(recordedAt)
    const todayKey = getCalendarDayKey(now)
    // 記録日を明示された場合は、その日へ揃えて書き戻しを行わない。
    const pinnedDayKey = options.recordedAt ? recordDayKey : null

    const canOverwriteDay = (dayKey: string): boolean =>
        canOverwriteRecordDay({
            dayKey,
            crawlDayKey: recordDayKey,
            todayKey,
            overwriteExisting,
            overwriteTodayOnly,
        })

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

    const { entries: resolved, unmatched } = resolveZaimEntries(categories, snapshot)

    // 未対応の項目は名称しか返らない。画面へ金額まで出せるよう、取得結果から引き直す
    // （`matchZaimSnapshot` が報告に使う表記と同じキーで並べる）。
    const amountByName = new Map<string, number>()
    for (const holding of snapshot.holdings) amountByName.set(holdingRowName(holding), holding.amount)
    for (const balance of snapshot.balances) amountByName.set(balance.name, balance.amount)
    const unmatchedEntries: ZaimSyncUnmatchedEntry[] = unmatched.map((name) => ({
        name,
        amount: amountByName.get(name) ?? null,
    }))

    // 記録日は行ごとに決まる。巡回時刻までに当日の残高が載らない口座（SBI証券など）は、
    // その値が実際に属する日へ書き戻す（#258）。
    const entries: ZaimSyncEntry[] = resolved.map((entry) => ({
        ...entry,
        recordDayKey: pinnedDayKey ?? resolveEntryRecordDayKey(entry.lastUpdatedAt, recordDayKey),
    }))

    const nothingSaved = (staleSkipped: boolean): ZaimSyncResult => ({
        updated: 0,
        skipped: 0,
        skippedEntries: [],
        savedEntries: [],
        unmatched,
        unmatchedEntries,
        entries,
        dryRun,
        recordDayKey,
        freshness,
        staleSkipped,
    })

    if (dryRun) return nothingSaved(false)

    // 巡回が止まっている日に前回の残高を当日の値として書き込まないよう、保存の前に止める。
    if (requireFresh && (freshness.empty || freshness.stale)) return nothingSaved(true)

    let updated = 0
    const skippedEntries: ZaimSyncSkippedEntry[] = []
    const savedEntries: ZaimSyncSavedEntry[] = []

    for (const entry of entries) {
        const entryDate = parseValuationDateInput(entry.recordDayKey)
        const existing = await findValuationChangeForDay(entry.categoryId, entryDate, userId)
        const hasValueToday = Boolean(existing?.assetId)
        // 記録日分があればそれを、無ければそれ以前の直近を変動判定の基準にする。
        const baselineValue = hasValueToday
            ? existing!.value
            : await findLatestValuationBefore(entry.categoryId, entryDate, userId)

        const decision = decideZaimAutoSave({
            hasValueToday,
            baselineValue,
            amount: entry.amount,
            overwriteExisting: canOverwriteDay(entry.recordDayKey),
            detectLargeDiff,
            // 記録日は最終更新の日そのものなので、ここで残るのは書き戻せる範囲より
            // 古い口座（連携が止まっている）だけになる。
            sourceIsStale: isStaleForDay(entry.lastUpdatedAt, entry.recordDayKey),
            detectStaleSource,
        })

        if (decision.action === "skip") {
            skippedEntries.push({
                categoryId: entry.categoryId,
                categoryName: entry.categoryName,
                amount: entry.amount,
                recordDayKey: entry.recordDayKey,
                baselineValue,
                lastUpdatedAt: entry.lastUpdatedAt,
                reason: decision.reason,
            })
            continue
        }

        const result = await upsertValuationChange({
            categoryId: entry.categoryId,
            userId,
            date: entryDate,
            value: entry.amount,
            confirmOverwrite: true,
            createTransaction: false,
        })

        if ("needsConfirmation" in result || !result.success) {
            skippedEntries.push({
                categoryId: entry.categoryId,
                categoryName: entry.categoryName,
                amount: entry.amount,
                recordDayKey: entry.recordDayKey,
                baselineValue,
                lastUpdatedAt: entry.lastUpdatedAt,
                reason: "writeFailed",
            })
            continue
        }

        savedEntries.push({
            categoryId: entry.categoryId,
            categoryName: entry.categoryName,
            amount: entry.amount,
            recordDayKey: entry.recordDayKey,
            baselineValue,
            sources: entry.sources,
        })
        updated += 1
    }

    return {
        updated,
        skipped: skippedEntries.length,
        skippedEntries,
        savedEntries,
        unmatched,
        unmatchedEntries,
        entries,
        dryRun: false,
        recordDayKey,
        freshness,
        staleSkipped: false,
    }
}
