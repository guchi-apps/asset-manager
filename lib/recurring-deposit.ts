/**
 * 積立の自動登録：設定の読み書きと、月に一度の判定・登録（Issue #343）。
 *
 * 判定そのものは `lib/recurring-deposit-detect.ts`（純粋関数）にあり、ここは
 * 評価額の記録を読んで渡し、結果を `Transaction` として書くだけ。定期実行の入口は
 * `scripts/recurring-deposits.ts`、結果の記録は `lib/data-fetch-log.ts` が受け持つ。
 */

import { prisma } from "@/lib/prisma"
import { TransactionType } from "@prisma/client"
import {
    getCalendarDayKey,
    getJstDayBounds,
    parseValuationDateInput,
} from "@/lib/valuation-day"
import type { DataFetchItemInput } from "@/lib/data-fetch-log"
import type { DataFetchOutcomeKey, DataFetchReasonKey } from "@/lib/data-fetch-view"
import {
    RECURRING_DEPOSIT_MEMO,
    RECURRING_DEPOSIT_PICKED_MEMO,
    buildDepositCandidates,
    describeDepositCandidate,
    detectDepositDay,
    isValidDayKey,
    rankDepositCandidates,
    resolveDepositWindow,
    resolveExpectedDayOfMonth,
    resolveTargetMonth,
    type DepositCandidate,
    type ValuationPoint,
} from "@/lib/recurring-deposit-detect"

export { RECURRING_DEPOSIT_MEMO } from "@/lib/recurring-deposit-detect"

/** 1件ぶんの積立設定（画面へ渡す形）。 */
export interface RecurringDepositRuleView {
    id: number
    categoryId: number
    categoryName: string
    categoryColor: string
    amount: number
    expectedDay: number
    enabled: boolean
    /** 判定を終えた最後の対象月（`YYYY-MM`） */
    lastProcessedMonth: string | null
    /** 直近の判定で入金日として選んだ日（`YYYY-MM-DD`） */
    lastDetectedDay: string | null
    /** 直近の判定で作った入金。取り消せる場合だけ入る */
    lastTransactionId: number | null
}

/** 画面から保存されてくる1件ぶん。 */
export interface RecurringDepositInput {
    categoryId: number
    amount: number
    expectedDay: number
    enabled: boolean
}

export async function listRecurringDeposits(userId: string): Promise<RecurringDepositRuleView[]> {
    const rules = await prisma.recurringDeposit.findMany({
        where: { userId },
        include: { category: { select: { name: true, color: true } } },
        orderBy: { id: "asc" },
    })

    return rules.map((rule) => ({
        id: rule.id,
        categoryId: rule.categoryId,
        categoryName: rule.category.name,
        categoryColor: rule.category.color,
        amount: Number(rule.amount),
        expectedDay: rule.expectedDay,
        enabled: rule.enabled,
        lastProcessedMonth: rule.lastProcessedMonth,
        lastDetectedDay: rule.lastDetectedDay,
        lastTransactionId: rule.lastTransactionId,
    }))
}

export type SaveRecurringDepositsResult = { success: true } | { success: false; error: string }

/**
 * 設定を一覧ごと保存する（`ZaimSettingsDialog` と同じ「全体を保存」の形）。
 * 渡されなかったカテゴリの設定は削除する。
 */
export async function saveRecurringDeposits(
    userId: string,
    inputs: RecurringDepositInput[]
): Promise<SaveRecurringDepositsResult> {
    const seen = new Set<number>()
    for (const input of inputs) {
        if (seen.has(input.categoryId)) {
            return { success: false, error: "同じ資産の積立を2件登録することはできません" }
        }
        seen.add(input.categoryId)

        if (!Number.isFinite(input.amount) || input.amount <= 0) {
            return { success: false, error: "毎月の入金額は1円以上で入力してください" }
        }
        if (!Number.isInteger(input.expectedDay) || input.expectedDay < 1 || input.expectedDay > 31) {
            return { success: false, error: "およその入金日は1〜31の範囲で入力してください" }
        }
    }

    // 他人のカテゴリを指定されても書かない。
    const owned = await prisma.category.findMany({
        where: { userId, id: { in: [...seen] } },
        select: { id: true },
    })
    if (owned.length !== seen.size) {
        return { success: false, error: "選べない資産が含まれています" }
    }

    const existing = await prisma.recurringDeposit.findMany({
        where: { userId },
        select: { id: true, categoryId: true },
    })
    const removedIds = existing
        .filter((rule) => !seen.has(rule.categoryId))
        .map((rule) => rule.id)

    await prisma.$transaction([
        ...(removedIds.length > 0
            ? [prisma.recurringDeposit.deleteMany({ where: { id: { in: removedIds }, userId } })]
            : []),
        ...inputs.map((input) =>
            prisma.recurringDeposit.upsert({
                where: { userId_categoryId: { userId, categoryId: input.categoryId } },
                create: {
                    userId,
                    categoryId: input.categoryId,
                    amount: input.amount,
                    expectedDay: input.expectedDay,
                    enabled: input.enabled,
                },
                // 判定の進み具合（lastProcessedMonth など）は保存では触らない。
                update: {
                    amount: input.amount,
                    expectedDay: input.expectedDay,
                    enabled: input.enabled,
                },
            })
        ),
    ])

    return { success: true }
}

export type CancelRecurringDepositResult = { success: true } | { success: false; error: string }

/**
 * 直近に自動登録した入金を取り消す。
 *
 * **`Asset`（評価額）には触らない。** 資産詳細の履歴からの削除（`deleteHistoryItem`）は
 * 同じ時刻のAsset行もまとめて消すため、Zaimが記録したその日の評価額まで失われる。
 * 自動登録の取り消しは取引だけを消したいので、専用の口をここに置く。
 */
export async function cancelRecurringDeposit(
    userId: string,
    ruleId: number
): Promise<CancelRecurringDepositResult> {
    const rule = await prisma.recurringDeposit.findFirst({ where: { id: ruleId, userId } })
    if (!rule) return { success: false, error: "積立の設定が見つかりません" }
    if (!rule.lastTransactionId) {
        return { success: false, error: "取り消せる入金がありません" }
    }

    // 判定済みの月（lastProcessedMonth）は進めたままにする。取り消した月をもう一度
    // 自動で登録し直すと、同じ判定が同じ結果になるだけで無限に戻ってくる。
    await prisma.$transaction([
        prisma.transaction.deleteMany({ where: { id: rule.lastTransactionId, userId } }),
        prisma.recurringDeposit.update({
            where: { id: rule.id },
            data: { lastTransactionId: null, lastDetectedDay: null },
        }),
    ])

    return { success: true }
}

/** 判定した1件の結果。画面の明細・通知・ログで共通に使う。 */
export interface RecurringDepositEntry {
    ruleId: number
    categoryId: number
    categoryName: string
    amount: number
    /** 判定した対象月（`YYYY-MM`） */
    targetMonth: string
    windowFrom: string
    windowTo: string
    outcome: DataFetchOutcomeKey
    reason: DataFetchReasonKey | null
    detail: string
    /** 入金日として選んだ日。選べなかった場合は null */
    detectedDay: string | null
    /** 作った取引のid。dry-run と未登録は null */
    transactionId: number | null
    /** 比較のもとにした評価額。明細の「前回値」に出す */
    previousValue: number | null
}

export interface RecurringDepositRunResult {
    /** 有効な設定の数。0 なら「設定がまだ無い」 */
    enabledRules: number
    /** その日に判定したぶんだけ。窓がまだ閉じていない・判定済みの月は含まない */
    entries: RecurringDepositEntry[]
    registered: number
    skipped: number
    failed: number
    todayKey: string
}

/** 同じ日に複数のAsset行があれば、あとに記録されたほうを採る。 */
function toValuationPoints(
    assets: { recordedAt: Date; currentValue: number }[]
): ValuationPoint[] {
    const byDay = new Map<string, number>()
    for (const asset of assets) {
        byDay.set(getCalendarDayKey(asset.recordedAt), Number(asset.currentValue))
    }
    return [...byDay.entries()]
        .map(([dayKey, value]) => ({ dayKey, value }))
        .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
}

/** 窓の中の評価額の記録を日ごとに畳んで読む（窓の最初の日の増減を出すため、直前の記録も1件足す）。 */
async function loadValuationPoints(
    userId: string,
    categoryId: number,
    window: { from: string; to: string }
): Promise<ValuationPoint[]> {
    const windowStart = getJstDayBounds(window.from).start
    const windowEnd = getJstDayBounds(window.to).end
    const [previousAsset, assetsInWindow] = await Promise.all([
        prisma.asset.findFirst({
            where: { categoryId, userId, recordedAt: { lt: windowStart } },
            orderBy: { recordedAt: "desc" },
            select: { recordedAt: true, currentValue: true },
        }),
        prisma.asset.findMany({
            where: { categoryId, userId, recordedAt: { gte: windowStart, lte: windowEnd } },
            orderBy: { recordedAt: "asc" },
            select: { recordedAt: true, currentValue: true },
        }),
    ])
    return toValuationPoints([...(previousAsset ? [previousAsset] : []), ...assetsInWindow])
}

/** 手入力とぶつからないよう調べる範囲（対象月と窓を合わせたもの）。 */
function resolveDepositCheckRange(
    month: string,
    window: { from: string; to: string }
): { from: string; to: string } {
    const monthStart = `${month}-01`
    const monthEnd = resolveExpectedDayOfMonth(month, 31)
    return {
        from: monthStart < window.from ? monthStart : window.from,
        to: monthEnd > window.to ? monthEnd : window.to,
    }
}

function formatDay(dayKey: string): string {
    return dayKey.slice(5).replace("-", "/")
}

function describeWindow(from: string, to: string): string {
    return `${formatDay(from)}〜${formatDay(to)}`
}

function describeNearest(nearest: DepositCandidate | null): string {
    if (!nearest) return "窓の中に比べられる評価額の記録がありませんでした。"
    return `いちばん近いのは ${formatDay(nearest.dayKey)}（${describeDepositCandidate(nearest)}）でした。`
}

/**
 * 有効な設定を1件ずつ判定し、入金日が決まったものだけ登録する。
 *
 * **同じ月を二度登録しない**ための守りは3つある。
 * 1. `lastProcessedMonth` — 判定を終えた月は、登録できたかどうかによらず二度と判定しない
 * 2. 対象月にすでに入金がある資産は判定しない（手入力とぶつからない）
 * 3. 窓が閉じるまで判定しない（`resolveTargetMonth`）
 *
 * PM2の `cron_restart` はデプロイのたびにもプロセスを1度起動するため、1がとくに効く。
 */
export async function runRecurringDeposits(
    userId: string,
    options: { dryRun?: boolean; now?: Date } = {}
): Promise<RecurringDepositRunResult> {
    const now = options.now ?? new Date()
    const todayKey = getCalendarDayKey(now)
    const rules = await prisma.recurringDeposit.findMany({
        where: { userId, enabled: true },
        include: { category: { select: { name: true } } },
        orderBy: { id: "asc" },
    })

    const entries: RecurringDepositEntry[] = []

    for (const rule of rules) {
        const targetMonth = resolveTargetMonth(todayKey, rule.expectedDay)

        // 判定済みの月は二度と触らない（同じ通知が毎日飛ぶのも防ぐ）。
        if (rule.lastProcessedMonth && rule.lastProcessedMonth >= targetMonth) continue

        const window = resolveDepositWindow(targetMonth, rule.expectedDay)

        // 設定を作る前に閉じた窓は判定しない。設定した晩にいきなり前月ぶんを遡って
        // 登録したり「未検出」を通知したりしないための線引きで、対象月だけ進めて次へ送る。
        if (window.to < getCalendarDayKey(rule.createdAt)) {
            if (!options.dryRun) {
                await prisma.recurringDeposit.update({
                    where: { id: rule.id },
                    data: { lastProcessedMonth: targetMonth },
                })
            }
            continue
        }

        const amount = Number(rule.amount)
        const base = {
            ruleId: rule.id,
            categoryId: rule.categoryId,
            categoryName: rule.category.name,
            amount,
            targetMonth,
            windowFrom: window.from,
            windowTo: window.to,
        }

        // 手入力とぶつからないよう、対象月と窓を合わせた範囲に入金がないかを見る。
        const check = resolveDepositCheckRange(targetMonth, window)
        const existingDeposit = await prisma.transaction.findFirst({
            where: {
                categoryId: rule.categoryId,
                userId,
                type: TransactionType.DEPOSIT,
                transactedAt: {
                    gte: getJstDayBounds(check.from).start,
                    lte: getJstDayBounds(check.to).end,
                },
            },
            orderBy: { transactedAt: "asc" },
        })

        if (existingDeposit) {
            entries.push({
                ...base,
                outcome: "SKIPPED",
                reason: "alreadyRegistered",
                detail:
                    `${formatDay(getCalendarDayKey(existingDeposit.transactedAt))} に` +
                    ` ${Math.round(Number(existingDeposit.amount)).toLocaleString()}円 の入金があるため、判定していません。`,
                detectedDay: null,
                transactionId: null,
                previousValue: null,
            })
            if (!options.dryRun) {
                // 既存の入金を「登録」として紐づける。紐づけないと、手動で先に入金を足した月が
                // 「未検出」と表示されてしまう（#646）。
                await prisma.recurringDeposit.update({
                    where: { id: rule.id },
                    data: {
                        lastProcessedMonth: targetMonth,
                        lastDetectedDay: getCalendarDayKey(existingDeposit.transactedAt),
                        lastTransactionId: existingDeposit.id,
                    },
                })
            }
            continue
        }

        const points = await loadValuationPoints(userId, rule.categoryId, window)

        const detection = detectDepositDay({
            points,
            amount,
            windowFrom: window.from,
            windowTo: window.to,
        })

        if (!detection.detected) {
            entries.push({
                ...base,
                outcome: "SKIPPED",
                reason: detection.reason,
                detail: `${describeWindow(window.from, window.to)} で判定しました。${describeNearest(detection.nearest)}`,
                detectedDay: null,
                transactionId: null,
                previousValue: detection.nearest?.previousValue ?? null,
            })
            if (!options.dryRun) {
                await prisma.recurringDeposit.update({
                    where: { id: rule.id },
                    data: {
                        lastProcessedMonth: targetMonth,
                        lastDetectedDay: null,
                        lastTransactionId: null,
                    },
                })
            }
            continue
        }

        const candidate = detection.candidate
        if (options.dryRun) {
            entries.push({
                ...base,
                outcome: "REFLECTED",
                reason: null,
                detail: describeDepositCandidate(candidate),
                detectedDay: candidate.dayKey,
                transactionId: null,
                previousValue: candidate.previousValue,
            })
            continue
        }

        try {
            const created = await prisma.transaction.create({
                data: {
                    categoryId: rule.categoryId,
                    userId,
                    type: TransactionType.DEPOSIT,
                    amount,
                    // 評価額のスナップショット（Asset行）は作らない。その日の評価額は
                    // Zaimの自動取得がすでに入れており、上書きすると取得値を壊す。
                    transactedAt: parseValuationDateInput(candidate.dayKey),
                    memo: RECURRING_DEPOSIT_MEMO,
                },
            })

            await prisma.recurringDeposit.update({
                where: { id: rule.id },
                data: {
                    lastProcessedMonth: targetMonth,
                    lastDetectedDay: candidate.dayKey,
                    lastTransactionId: created.id,
                },
            })

            entries.push({
                ...base,
                outcome: "REFLECTED",
                reason: null,
                detail: describeDepositCandidate(candidate),
                detectedDay: candidate.dayKey,
                transactionId: created.id,
                previousValue: candidate.previousValue,
            })
        } catch (error) {
            // 対象月は進めない。次の実行でもう一度試せるようにする。
            console.error("積立の自動登録に失敗しました", error)
            entries.push({
                ...base,
                outcome: "FAILED",
                reason: "depositWriteFailed",
                detail: error instanceof Error ? error.message : String(error),
                detectedDay: candidate.dayKey,
                transactionId: null,
                previousValue: candidate.previousValue,
            })
        }
    }

    return {
        enabledRules: rules.length,
        entries,
        registered: entries.filter((entry) => entry.outcome === "REFLECTED").length,
        skipped: entries.filter((entry) => entry.outcome === "SKIPPED").length,
        failed: entries.filter((entry) => entry.outcome === "FAILED").length,
        todayKey,
    }
}

/** 実行結果を「データ取得状況」の明細へ落とす（`buildZaimFetchItems` と同じ役割）。 */
export function buildRecurringDepositFetchItems(
    result: RecurringDepositRunResult
): DataFetchItemInput[] {
    return result.entries.map((entry) => ({
        outcome: entry.outcome,
        label: entry.categoryName,
        source: `${entry.targetMonth} · ${describeWindow(entry.windowFrom, entry.windowTo)}`,
        amount: entry.outcome === "REFLECTED" ? entry.amount : null,
        previousValue: entry.previousValue,
        recordDay: entry.detectedDay,
        reason: entry.reason,
        detail: entry.detail,
    }))
}

function shiftMonth(month: string, delta: number): string {
    const [year, monthNumber] = month.split("-").map(Number)
    const at = new Date(Date.UTC(year, monthNumber - 1 + delta, 1))
    return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`
}

/**
 * 入金を手動で足した・直した・消したあとに、積立の状態を入金の実態へ合わせる（Issue #646）。
 *
 * 判定は窓が閉じるまで走らないため、手動で先に入金を足した月は「判定待ち」のまま、
 * 窓が閉じたあとは既存入金ありで見送られて「未検出」と表示されていた。入金が実在するなら
 * 「登録」にする。**取引の書き込みとは別の操作**で、何度呼んでも結果が変わらない
 * （失敗しても入金は残り、次に呼ばれたときか定期実行の `alreadyRegistered` で追いつく）。
 */
export async function reconcileRecurringDepositLink(
    userId: string,
    categoryId: number,
    now: Date = new Date()
): Promise<void> {
    const rule = await prisma.recurringDeposit.findFirst({ where: { userId, categoryId } })
    if (!rule) return

    if (rule.lastTransactionId) {
        const linked = await prisma.transaction.findFirst({
            where: { id: rule.lastTransactionId, userId },
        })
        if (linked && linked.type === TransactionType.DEPOSIT) {
            const day = getCalendarDayKey(linked.transactedAt)
            if (day !== rule.lastDetectedDay) {
                await prisma.recurringDeposit.update({
                    where: { id: rule.id },
                    data: { lastDetectedDay: day },
                })
            }
            return
        }
        // 紐づけていた入金が消えた（入金以外に変えた）。解除して、他に入金があれば探し直す。
        await prisma.recurringDeposit.update({
            where: { id: rule.id },
            data: { lastTransactionId: null, lastDetectedDay: null },
        })
    }

    // 判定済みの月より前は触らない（過ぎた月の入金を今月へ付け替えない）。
    const processed = rule.lastProcessedMonth
    const thisMonth = getCalendarDayKey(now).slice(0, 7)
    const months = [
        ...new Set(
            [
                ...(processed ? [processed, shiftMonth(processed, 1)] : []),
                shiftMonth(thisMonth, -1),
                thisMonth,
            ].filter((month) => !processed || month >= processed)
        ),
    ].sort()

    for (const month of months) {
        const check = resolveDepositCheckRange(
            month,
            resolveDepositWindow(month, rule.expectedDay)
        )
        const deposit = await prisma.transaction.findFirst({
            where: {
                categoryId,
                userId,
                type: TransactionType.DEPOSIT,
                transactedAt: {
                    gte: getJstDayBounds(check.from).start,
                    lte: getJstDayBounds(check.to).end,
                },
            },
            orderBy: { transactedAt: "asc" },
        })
        if (!deposit) continue

        await prisma.recurringDeposit.update({
            where: { id: rule.id },
            data: {
                lastProcessedMonth: processed && processed > month ? processed : month,
                lastDetectedDay: getCalendarDayKey(deposit.transactedAt),
                lastTransactionId: deposit.id,
            },
        })
        return
    }
}

export type DepositSuggestions =
    | {
          success: true
          categoryName: string
          amount: number
          /** 判定した対象月（`YYYY-MM`） */
          month: string
          windowFrom: string
          windowTo: string
          /** 入金額に近い順。記録が飛んだ区間も含む（`gapDays` で見分ける） */
          candidates: DepositCandidate[]
      }
    | { success: false; error: string }

/** 「未検出」の月について、入金日の候補を近い順に返す。 */
export async function suggestRecurringDepositDays(
    userId: string,
    ruleId: number
): Promise<DepositSuggestions> {
    const rule = await prisma.recurringDeposit.findFirst({
        where: { id: ruleId, userId },
        include: { category: { select: { name: true } } },
    })
    if (!rule) return { success: false, error: "積立の設定が見つかりません" }
    if (rule.lastTransactionId || !rule.lastProcessedMonth) {
        return { success: false, error: "入金日を選べる月がありません" }
    }

    const amount = Number(rule.amount)
    const window = resolveDepositWindow(rule.lastProcessedMonth, rule.expectedDay)
    const points = await loadValuationPoints(userId, rule.categoryId, window)

    return {
        success: true,
        categoryName: rule.category.name,
        amount,
        month: rule.lastProcessedMonth,
        windowFrom: window.from,
        windowTo: window.to,
        candidates: rankDepositCandidates(
            buildDepositCandidates({
                points,
                amount,
                windowFrom: window.from,
                windowTo: window.to,
            })
        ),
    }
}

export type RegisterRecurringDepositDayResult =
    | { success: true; categoryId: number }
    | { success: false; error: string }

/**
 * 「未検出」の月の入金を、人が選んだ日で登録する。金額は設定の金額をそのまま使う。
 * 日付は判定した窓の中に限る（窓の外を許すと、別の月の入金とぶつかる）。
 */
export async function registerRecurringDepositDay(
    userId: string,
    ruleId: number,
    dayKey: string
): Promise<RegisterRecurringDepositDayResult> {
    const rule = await prisma.recurringDeposit.findFirst({ where: { id: ruleId, userId } })
    if (!rule) return { success: false, error: "積立の設定が見つかりません" }
    if (rule.lastTransactionId || !rule.lastProcessedMonth) {
        return { success: false, error: "登録できる月がありません" }
    }
    if (!isValidDayKey(dayKey)) return { success: false, error: "日付が正しくありません" }

    const window = resolveDepositWindow(rule.lastProcessedMonth, rule.expectedDay)
    if (dayKey < window.from || dayKey > window.to) {
        return {
            success: false,
            error: `${formatDay(window.from)}〜${formatDay(window.to)} の範囲で選んでください`,
        }
    }

    const check = resolveDepositCheckRange(rule.lastProcessedMonth, window)
    const existing = await prisma.transaction.findFirst({
        where: {
            categoryId: rule.categoryId,
            userId,
            type: TransactionType.DEPOSIT,
            transactedAt: {
                gte: getJstDayBounds(check.from).start,
                lte: getJstDayBounds(check.to).end,
            },
        },
    })
    if (existing) {
        return {
            success: false,
            error: `${formatDay(getCalendarDayKey(existing.transactedAt))} にすでに入金があります`,
        }
    }

    await prisma.$transaction(async (tx) => {
        const created = await tx.transaction.create({
            data: {
                categoryId: rule.categoryId,
                userId,
                type: TransactionType.DEPOSIT,
                amount: Number(rule.amount),
                transactedAt: parseValuationDateInput(dayKey),
                memo: RECURRING_DEPOSIT_PICKED_MEMO,
            },
        })
        await tx.recurringDeposit.update({
            where: { id: rule.id },
            data: { lastDetectedDay: dayKey, lastTransactionId: created.id },
        })
    })

    return { success: true, categoryId: rule.categoryId }
}
