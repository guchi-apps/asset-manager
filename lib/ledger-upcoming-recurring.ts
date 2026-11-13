/**
 * サマリーの日別の棒に重ねる「定期払いの予定」（Issue #1337）。DBに触らない純粋な関数。
 *
 * - 対象は今日の翌日〜期間末に支払い予定日が来る定期払い（サブスク・固定費）。今日の分は取引に入る前提で数えない
 * - 家計簿の期間は給料日基準で2つの暦月にまたがるので、期間にかかる各月を `getOccurrencesInMonth` で展開する
 * - 今期にすでに取引へ紐付け済みの定期払いは支払い済みとして除く
 * - 分割払いは終了日を保存しないので、回数ぶんの最終請求日を終了日に使う（`subscription-service.ts` と同じ導出。#1126）
 * - 外貨は円換算し、レートが無いものは数えない
 * - 着地の見込み（`computeSpendPace`）は過去ペースの比率で出しており、定期払いを既に含む。ここの金額は見込みへ足さない
 */
import { daysBetween, periodDays } from "@/lib/ledger-pace"
import type { LedgerPeriod } from "@/lib/ledger-period"
import {
    compareDayKey,
    convertToJpy,
    getContractStatus,
    getInstallmentProgress,
    getOccurrencesInMonth,
    isRenewalStopped,
    splitDayKey,
    type Currency,
    type DayKey,
    type PriceEntry,
} from "@/lib/subscription-billing"

export interface UpcomingSubscription {
    id: number
    name: string
    isInstallment: boolean
    installmentCount: number | null
    startDate: DayKey
    endDate: DayKey | null
    autoRenew: boolean
    cancelPlanned: boolean
    prices: PriceEntry[]
}

export interface UpcomingRecurringItem {
    subscriptionId: number
    name: string
    /** 円換算した金額（円未満は四捨五入） */
    amount: number
}

export interface UpcomingRecurring {
    /** 期間の全日ぶん。支払い予定が無い日は 0 */
    daily: number[]
    /** 日付（YYYY-MM-DD）→ その日の予定。無い日はキーが無い */
    items: Record<string, UpcomingRecurringItem[]>
    total: number
}

/** 終了日。手入力があればそれを使い、無ければ分割払いの最終請求日（導出できなければ null） */
function resolveEndDay(sub: UpcomingSubscription, today: DayKey): DayKey | null {
    if (sub.endDate) return sub.endDate
    if (!sub.isInstallment || !sub.installmentCount) return null
    return getInstallmentProgress({ startDate: sub.startDate, prices: sub.prices }, sub.installmentCount, today).lastDay
}

/**
 * 期間内の定期払いの予定。`paidIds` は今期の取引へ紐付け済みのサブスクid（支払い済み）。
 * 進行中でない期間（過去・未来）は null。予定が1件も無いときも null。
 */
export function computeUpcomingRecurring(
    period: LedgerPeriod,
    subscriptions: readonly UpcomingSubscription[],
    paidIds: ReadonlySet<number>,
    today: DayKey,
    usdJpyRate: number | null
): UpcomingRecurring | null {
    if (today < period.start || today >= period.end) return null
    const days = periodDays(period)
    const daily = new Array<number>(days).fill(0)
    const items: Record<string, UpcomingRecurringItem[]> = {}
    let total = 0

    const from = splitDayKey(period.start)
    const to = splitDayKey(period.end)
    for (const sub of subscriptions) {
        if (paidIds.has(sub.id) || sub.prices.length === 0) continue
        const endDay = resolveEndDay(sub, today)
        if (isRenewalStopped(getContractStatus(endDay, sub.cancelPlanned, today), endDay, sub.autoRenew)) continue
        const source = { startDate: sub.startDate, endDate: endDay, prices: sub.prices }
        let year = from.year
        let month = from.month
        while (year < to.year || (year === to.year && month <= to.month)) {
            for (const occurrence of getOccurrencesInMonth(source, year, month)) {
                if (compareDayKey(occurrence.day, today) <= 0 || compareDayKey(occurrence.day, period.end) > 0) continue
                const yen = convertToJpy(occurrence.amount, occurrence.currency as Currency, usdJpyRate)
                if (yen === null) continue
                const amount = Math.round(yen)
                daily[daysBetween(period.start, occurrence.day)] += amount
                ;(items[occurrence.day] ??= []).push({ subscriptionId: sub.id, name: sub.name, amount })
                total += amount
            }
            month += 1
            if (month > 12) {
                month = 1
                year += 1
            }
        }
    }
    return total > 0 ? { daily, items, total } : null
}
