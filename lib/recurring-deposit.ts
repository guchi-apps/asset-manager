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
    assignDepositMonth,
    buildDepositCandidates,
    describeDepositCandidate,
    detectDepositDay,
    isValidDayKey,
    isValidMonth,
    methodFromMemo,
    rankDepositCandidates,
    resolveDecisionAt,
    resolveDepositWindow,
    resolveExpectedDayOfMonth,
    resolveMonthState,
    resolveTargetMonth,
    shiftMonth,
    type DepositCandidate,
    type RecurringDepositMethod,
    type RecurringDepositRecordStatus,
    type RecurringMonthStateKey,
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
 * 指定した対象月に登録した入金を取り消す（#696で月指定になった）。
 *
 * **`Asset`（評価額）には触らない。** 資産詳細の履歴からの削除（`deleteHistoryItem`）は
 * 同じ時刻のAsset行もまとめて消すため、Zaimが記録したその日の評価額まで失われる。
 * 自動登録の取り消しは取引だけを消したいので、専用の口をここに置く。
 * 月別の記録は消さず「未検出」へ戻す（消すと次の判定で同じ月を登録し直してしまう）。
 */
export async function cancelRecurringDeposit(
    userId: string,
    ruleId: number,
    month: string
): Promise<CancelRecurringDepositResult> {
    if (!isValidMonth(month)) return { success: false, error: "対象月が正しくありません" }
    const rule = await prisma.recurringDeposit.findFirst({ where: { id: ruleId, userId } })
    if (!rule) return { success: false, error: "積立の設定が見つかりません" }

    const record = await prisma.recurringDepositMonth.findUnique({
        where: { userId_categoryId_month: { userId, categoryId: rule.categoryId, month } },
    })
    if (!record?.transactionId) {
        return { success: false, error: "取り消せる入金がありません" }
    }

    await prisma.$transaction([
        prisma.transaction.deleteMany({ where: { id: record.transactionId, userId } }),
        prisma.recurringDepositMonth.update({
            where: { id: record.id },
            data: {
                status: "UNDETECTED",
                method: null,
                detectedDay: null,
                transactionId: null,
                reason: "cancelled",
                detail: "登録した入金を取り消しました。",
                decidedAt: new Date(),
            },
        }),
        ...(rule.lastTransactionId === record.transactionId
            ? [
                  prisma.recurringDeposit.update({
                      where: { id: rule.id },
                      data: { lastTransactionId: null, lastDetectedDay: null },
                  }),
              ]
            : []),
    ])

    return { success: true }
}

/** 月別の記録の書き込み内容。 */
interface MonthRecordWrite {
    ruleId: number | null
    amount: number
    expectedDay: number
    status: RecurringDepositRecordStatus
    method: RecurringDepositMethod | null
    detectedDay: string | null
    transactionId: number | null
    reason: string | null
    detail: string | null
    decidedAt: Date
}

type MonthRecordDb = Pick<typeof prisma, "recurringDepositMonth">

function saveMonthRecord(
    db: MonthRecordDb,
    userId: string,
    categoryId: number,
    month: string,
    data: MonthRecordWrite
) {
    return db.recurringDepositMonth.upsert({
        where: { userId_categoryId_month: { userId, categoryId, month } },
        create: { userId, categoryId, month, ...data },
        update: data,
    })
}

/**
 * 対象月に属する入金を探す。**他の月の記録に紐づいた入金は除く**（月をまたぐ判定範囲で
 * 隣の月の入金を誤って紐づけたり、二重に登録したりしないため）。
 */
async function findDepositForMonth(
    userId: string,
    categoryId: number,
    month: string,
    expectedDay: number
) {
    const check = resolveDepositCheckRange(month, resolveDepositWindow(month, expectedDay))
    const [deposits, linkedElsewhere] = await Promise.all([
        prisma.transaction.findMany({
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
        }),
        prisma.recurringDepositMonth.findMany({
            where: { userId, categoryId, transactionId: { not: null }, month: { not: month } },
            select: { transactionId: true },
        }),
    ])
    const taken = new Set(linkedElsewhere.map((row) => row.transactionId))
    return (
        deposits.find(
            (deposit) =>
                !taken.has(deposit.id) &&
                assignDepositMonth(getCalendarDayKey(deposit.transactedAt), expectedDay) === month
        ) ?? null
    )
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
 * 1. 月別の記録（`RecurringDepositMonth`）— 判定を終えた月は、登録できたかどうかによらず二度と判定しない（失敗した月だけ再試行）
 * 2. その対象月に属する入金がすでにある資産は判定しない（手入力とぶつからない。隣の月の入金は数えない）
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

        // 判定済みの月は二度と触らない（同じ通知が毎日飛ぶのも防ぐ）。月別の記録を正とし、
        // 失敗した月（FAILED）だけは次の実行でもう一度試す。
        const recorded = await prisma.recurringDepositMonth.findUnique({
            where: {
                userId_categoryId_month: { userId, categoryId: rule.categoryId, month: targetMonth },
            },
            select: { status: true },
        })
        if (recorded && recorded.status !== "FAILED") continue

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

        // 手入力とぶつからないよう、この対象月に属する入金がないかを見る（隣の月の入金は数えない）。
        const existingDeposit = await findDepositForMonth(
            userId,
            rule.categoryId,
            targetMonth,
            rule.expectedDay
        )

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
                await saveMonthRecord(prisma, userId, rule.categoryId, targetMonth, {
                    ruleId: rule.id,
                    amount,
                    expectedDay: rule.expectedDay,
                    status: "REGISTERED",
                    method: methodFromMemo(existingDeposit.memo),
                    detectedDay: getCalendarDayKey(existingDeposit.transactedAt),
                    transactionId: existingDeposit.id,
                    reason: null,
                    detail: null,
                    decidedAt: now,
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
                await saveMonthRecord(prisma, userId, rule.categoryId, targetMonth, {
                    ruleId: rule.id,
                    amount,
                    expectedDay: rule.expectedDay,
                    status: "UNDETECTED",
                    method: null,
                    detectedDay: null,
                    transactionId: null,
                    reason: detection.reason,
                    detail: `${describeWindow(window.from, window.to)} で判定しました。${describeNearest(detection.nearest)}`,
                    decidedAt: now,
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
            await saveMonthRecord(prisma, userId, rule.categoryId, targetMonth, {
                ruleId: rule.id,
                amount,
                expectedDay: rule.expectedDay,
                status: "REGISTERED",
                method: "AUTO",
                detectedDay: candidate.dayKey,
                transactionId: created.id,
                reason: null,
                detail: describeDepositCandidate(candidate),
                decidedAt: now,
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
            await saveMonthRecord(prisma, userId, rule.categoryId, targetMonth, {
                ruleId: rule.id,
                amount,
                expectedDay: rule.expectedDay,
                status: "FAILED",
                method: null,
                detectedDay: candidate.dayKey,
                transactionId: null,
                reason: "depositWriteFailed",
                detail: error instanceof Error ? error.message : String(error),
                decidedAt: now,
            }).catch((recordError) => console.error("積立の失敗の記録に失敗しました", recordError))
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

/** 積立の登録に数える状態。 */
const REGISTERED_STATES: RecurringMonthStateKey[] = [
    "autoRegistered",
    "manualRegistered",
    "registeredUnknown",
]
/** 人の対応が要る状態（判定待ち・予定は含まない）。 */
const ATTENTION_STATES: RecurringMonthStateKey[] = ["undetected", "notRun", "failed"]

/** 画面に出す、対象月1件ぶんの積立の状況。 */
export interface RecurringDepositMonthEntry {
    ruleId: number
    categoryId: number
    categoryName: string
    categoryColor: string
    month: string
    /** その月の記録に写した金額（記録が無ければ現在の設定） */
    amount: number
    expectedDay: number
    /** 予定日（`YYYY-MM-DD`） */
    expectedDate: string
    windowFrom: string
    windowTo: string
    /** 判定予定日時（`YYYY-MM-DD 23:55`）。月をまたぐことがある */
    decisionAt: string
    state: RecurringMonthStateKey
    /** 入金日（登録済みのとき） */
    detectedDay: string | null
    transactionId: number | null
    /** 判定・登録を実施した実際の日時（ISO）。判定していなければ null */
    decidedAt: string | null
    /** 未検出・失敗の理由 */
    detail: string | null
    /** 登録済みの入金が月別の記録へ紐づいていない（確認して紐づけられる） */
    needsLink: boolean
    canRegister: boolean
    canCancel: boolean
    /** 手入力ではなく日付を選んで登録した入金か（表示の補足用） */
    picked: boolean
}

export interface RecurringDepositMonthView {
    month: string
    /** JSTの今月。初期表示と「今月へ」に使う */
    thisMonth: string
    entries: RecurringDepositMonthEntry[]
    counts: { registered: number; pending: number; upcoming: number; attention: number; needsLink: number }
}

/**
 * 対象月の状況を読む。**読み取りだけで、取引も記録も作らない**（月を切り替えて眺めても
 * 判定や登録は走らない）。記録の無い月は、実在する入金と設定から状態を導く。
 */
export async function getRecurringDepositMonthView(
    userId: string,
    month: string,
    now: Date = new Date()
): Promise<RecurringDepositMonthView> {
    const todayKey = getCalendarDayKey(now)
    const thisMonth = todayKey.slice(0, 7)

    const [rules, records] = await Promise.all([
        prisma.recurringDeposit.findMany({
            where: { userId },
            include: { category: { select: { name: true, color: true } } },
            orderBy: { id: "asc" },
        }),
        prisma.recurringDepositMonth.findMany({ where: { userId, month } }),
    ])

    const entries: RecurringDepositMonthEntry[] = []
    for (const rule of rules) {
        const record = records.find((row) => row.categoryId === rule.categoryId) ?? null
        const amount = record ? record.amount : Number(rule.amount)
        const expectedDay = record ? record.expectedDay : rule.expectedDay
        const window = resolveDepositWindow(month, expectedDay)

        const linked = record?.transactionId
            ? await prisma.transaction.findFirst({
                  where: { id: record.transactionId, userId, type: TransactionType.DEPOSIT },
              })
            : null
        const deposit =
            linked ?? (await findDepositForMonth(userId, rule.categoryId, month, expectedDay))

        const { state, needsLink } = resolveMonthState({
            month,
            thisMonth,
            todayKey,
            windowTo: window.to,
            enabled: rule.enabled,
            createdDayKey: getCalendarDayKey(rule.createdAt),
            record: record
                ? {
                      status: record.status as RecurringDepositRecordStatus,
                      method: record.method as RecurringDepositMethod | null,
                      transactionLive: !!linked,
                  }
                : null,
            liveDeposit: deposit ? { method: methodFromMemo(deposit.memo) } : null,
        })

        const registered = REGISTERED_STATES.includes(state)
        entries.push({
            ruleId: rule.id,
            categoryId: rule.categoryId,
            categoryName: rule.category.name,
            categoryColor: rule.category.color,
            month,
            amount,
            expectedDay,
            expectedDate: resolveExpectedDayOfMonth(month, expectedDay),
            windowFrom: window.from,
            windowTo: window.to,
            decisionAt: resolveDecisionAt(window),
            state,
            detectedDay: registered && deposit ? getCalendarDayKey(deposit.transactedAt) : null,
            transactionId: registered && deposit ? deposit.id : null,
            decidedAt: record ? record.decidedAt.toISOString() : null,
            detail: !registered && record ? record.detail : null,
            needsLink,
            canRegister: ATTENTION_STATES.includes(state) && month <= thisMonth,
            canCancel: registered && !needsLink && !!deposit,
            picked: registered && !!deposit && methodFromMemo(deposit.memo) === "PICKED",
        })
    }

    return {
        month,
        thisMonth,
        entries,
        counts: {
            registered: entries.filter((entry) => REGISTERED_STATES.includes(entry.state)).length,
            pending: entries.filter((entry) => entry.state === "pending").length,
            upcoming: entries.filter((entry) => entry.state === "upcoming").length,
            attention: entries.filter((entry) => ATTENTION_STATES.includes(entry.state)).length,
            needsLink: entries.filter((entry) => entry.needsLink).length,
        },
    }
}

/** 紐づけを調べる月の数の上限（設定を作った月から数える）。 */
const RECONCILE_MAX_MONTHS = 36

/**
 * 入金の実態に月別の記録を合わせる（Issue #646・#696）。手動で入金を足した・直した・消した
 * あとと、画面の「既存の入金を確認」から呼ばれる。**何度呼んでも結果が変わらない。**
 *
 * - 記録が紐づけている入金がいまも在れば、入金日だけ追従させる
 * - 在るべき入金が消えていれば「未検出」へ戻す（記録そのものは残す）
 * - 記録の無い月・未検出の月に、その月に属する入金が実在すれば「登録」として紐づける。
 *   登録方法は入金のメモから読み、印が無ければ手入力。他の月へ紐づいた入金は使わない
 *
 * 月の割り当ては `assignDepositMonth`（窓は隣の月と重ならない）。窓が閉じていない今月でも、
 * 実在する入金は紐づける。**取引は作らない。**
 */
export async function reconcileRecurringDepositLink(
    userId: string,
    categoryId: number,
    now: Date = new Date()
): Promise<void> {
    const rule = await prisma.recurringDeposit.findFirst({ where: { userId, categoryId } })
    if (!rule) return

    const todayKey = getCalendarDayKey(now)
    const thisMonth = todayKey.slice(0, 7)
    const records = await prisma.recurringDepositMonth.findMany({ where: { userId, categoryId } })

    const firstMonth = shiftMonth(getCalendarDayKey(rule.createdAt).slice(0, 7), -1)
    const months = new Set<string>(records.map((row) => row.month))
    for (let month = thisMonth, count = 0; month >= firstMonth && count < RECONCILE_MAX_MONTHS; count += 1) {
        months.add(month)
        month = shiftMonth(month, -1)
    }

    for (const month of [...months].sort()) {
        if (month > thisMonth) continue
        const record = records.find((row) => row.month === month) ?? null
        const amount = record ? record.amount : Number(rule.amount)
        const expectedDay = record ? record.expectedDay : rule.expectedDay

        const linked = record?.transactionId
            ? await prisma.transaction.findFirst({
                  where: { id: record.transactionId, userId, type: TransactionType.DEPOSIT },
              })
            : null

        if (record && record.status === "REGISTERED" && linked) {
            const day = getCalendarDayKey(linked.transactedAt)
            if (day !== record.detectedDay) {
                await prisma.recurringDepositMonth.update({
                    where: { id: record.id },
                    data: { detectedDay: day },
                })
            }
            continue
        }

        const deposit = await findDepositForMonth(userId, categoryId, month, expectedDay)
        if (deposit) {
            await saveMonthRecord(prisma, userId, categoryId, month, {
                ruleId: rule.id,
                amount,
                expectedDay,
                status: "REGISTERED",
                method: methodFromMemo(deposit.memo),
                detectedDay: getCalendarDayKey(deposit.transactedAt),
                transactionId: deposit.id,
                reason: null,
                detail: null,
                decidedAt: now,
            })
        } else if (record && record.status === "REGISTERED") {
            // 紐づけていた入金が消えた。記録は残し、未検出へ戻す。
            await saveMonthRecord(prisma, userId, categoryId, month, {
                ruleId: record.ruleId,
                amount: record.amount,
                expectedDay: record.expectedDay,
                status: "UNDETECTED",
                method: null,
                detectedDay: null,
                transactionId: null,
                reason: "depositRemoved",
                detail: "紐づけていた入金が見つからなくなりました。",
                decidedAt: now,
            })
        }
    }

    // 設定側の「直近」の写しを、いちばん新しい月の記録へ合わせる。
    const latest = await prisma.recurringDepositMonth.findFirst({
        where: { userId, categoryId },
        orderBy: { month: "desc" },
    })
    if (latest && (!rule.lastProcessedMonth || latest.month >= rule.lastProcessedMonth)) {
        await prisma.recurringDeposit.update({
            where: { id: rule.id },
            data: {
                lastProcessedMonth: latest.month,
                lastDetectedDay: latest.detectedDay,
                lastTransactionId: latest.transactionId,
            },
        })
    }
}

/** 全ての積立について入金の実態と月別の記録を合わせる（画面の「既存の入金を確認」）。 */
export async function reconcileAllRecurringDeposits(userId: string): Promise<number[]> {
    const rules = await prisma.recurringDeposit.findMany({
        where: { userId },
        select: { categoryId: true },
    })
    for (const rule of rules) {
        await reconcileRecurringDepositLink(userId, rule.categoryId)
    }
    return rules.map((rule) => rule.categoryId)
}

export type DepositSuggestions =
    | {
          success: true
          categoryName: string
          amount: number
          /** 登録する対象月（`YYYY-MM`） */
          month: string
          windowFrom: string
          windowTo: string
          /** 入金額に近い順。記録が飛んだ区間も含む（`gapDays` で見分ける） */
          candidates: DepositCandidate[]
      }
    | { success: false; error: string }

/** 登録先の対象月を検証し、その月の設定の写し（記録があればそれ）を返す。 */
async function resolveRegisterTarget(userId: string, ruleId: number, month: string) {
    if (!isValidMonth(month)) return { ok: false, error: "対象月が正しくありません" } as const
    if (month > getCalendarDayKey(new Date()).slice(0, 7)) {
        return { ok: false, error: "来月以降の入金は登録できません" } as const
    }
    const rule = await prisma.recurringDeposit.findFirst({
        where: { id: ruleId, userId },
        include: { category: { select: { name: true } } },
    })
    if (!rule) return { ok: false, error: "積立の設定が見つかりません" } as const

    const record = await prisma.recurringDepositMonth.findUnique({
        where: { userId_categoryId_month: { userId, categoryId: rule.categoryId, month } },
    })
    const linked = record?.transactionId
        ? await prisma.transaction.findFirst({
              where: { id: record.transactionId, userId, type: TransactionType.DEPOSIT },
          })
        : null
    const expectedDay = record ? record.expectedDay : rule.expectedDay
    const existing =
        linked ?? (await findDepositForMonth(userId, rule.categoryId, month, expectedDay))
    if (existing) {
        return {
            ok: false,
            error: `${month} ぶんは ${formatDay(getCalendarDayKey(existing.transactedAt))} にすでに入金があります`,
        } as const
    }
    return {
        ok: true,
        rule,
        amount: record ? record.amount : Number(rule.amount),
        expectedDay,
    } as const
}

/** 「未検出」などの月について、入金日の候補を近い順に返す。 */
export async function suggestRecurringDepositDays(
    userId: string,
    ruleId: number,
    month: string
): Promise<DepositSuggestions> {
    const target = await resolveRegisterTarget(userId, ruleId, month)
    if (!target.ok) return { success: false, error: target.error }

    const window = resolveDepositWindow(month, target.expectedDay)
    const points = await loadValuationPoints(userId, target.rule.categoryId, window)

    return {
        success: true,
        categoryName: target.rule.category.name,
        amount: target.amount,
        month,
        windowFrom: window.from,
        windowTo: window.to,
        candidates: rankDepositCandidates(
            buildDepositCandidates({
                points,
                amount: target.amount,
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
 * 指定した対象月の入金を、人が選んだ日で登録する。金額はその月の記録（無ければ設定）の金額。
 * 日付はその月の判定の窓の中に限る（窓の外を許すと、別の月の入金とぶつかる）。
 * 登録するのは指定した月の記録だけで、他の月の入金や記録は変えない。
 */
export async function registerRecurringDepositDay(
    userId: string,
    ruleId: number,
    month: string,
    dayKey: string
): Promise<RegisterRecurringDepositDayResult> {
    const target = await resolveRegisterTarget(userId, ruleId, month)
    if (!target.ok) return { success: false, error: target.error }
    if (!isValidDayKey(dayKey)) return { success: false, error: "日付が正しくありません" }

    const { rule, amount, expectedDay } = target
    const window = resolveDepositWindow(month, expectedDay)
    if (dayKey < window.from || dayKey > window.to) {
        return {
            success: false,
            error: `${month} ぶんは ${formatDay(window.from)}〜${formatDay(window.to)} の範囲で選んでください`,
        }
    }

    await prisma.$transaction(async (tx) => {
        const created = await tx.transaction.create({
            data: {
                categoryId: rule.categoryId,
                userId,
                type: TransactionType.DEPOSIT,
                amount,
                transactedAt: parseValuationDateInput(dayKey),
                memo: RECURRING_DEPOSIT_PICKED_MEMO,
            },
        })
        await saveMonthRecord(tx, userId, rule.categoryId, month, {
            ruleId: rule.id,
            amount,
            expectedDay,
            status: "REGISTERED",
            method: "PICKED",
            detectedDay: dayKey,
            transactionId: created.id,
            reason: null,
            detail: null,
            decidedAt: new Date(),
        })
        if (!rule.lastProcessedMonth || month >= rule.lastProcessedMonth) {
            await tx.recurringDeposit.update({
                where: { id: rule.id },
                data: {
                    lastProcessedMonth: month,
                    lastDetectedDay: dayKey,
                    lastTransactionId: created.id,
                },
            })
        }
    })

    return { success: true, categoryId: rule.categoryId }
}
