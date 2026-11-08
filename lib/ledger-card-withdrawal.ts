/**
 * カードの引き落とし予定と、引き落とし口座の残高の確認（Issue #1141）。DBに触らない純粋な関数だけを置く。
 *
 * - カード口座に「締め日・引き落とし日・引き落とし先の口座」を持たせ、締め日ごとの請求サイクルを作る
 * - 1サイクルの引き落とし額は **推計** で、カード会社の確定請求額ではない:
 *   `締め日時点のカード残高の負債額 − 締め日の翌日から今日までのカード口座への入金（繰上げ返済など）`
 *   から、同じ窓で先に引き落とされるサイクルの額を引く。カードの残高は累積なので、前回分が未払いのまま次の
 *   締め日が来ると前回分を含む。先のサイクルの額を引くことで二重に数えない
 * - 引き落とし日が休日・年末年始なら翌営業日へ送る。29〜31日は月末に丸める（31日＝月末の扱い）
 * - 引き落とし口座の残高は「今の残高 − それ以前（同日を含む）の引き落とし予定の合計」で判定する。
 *   将来の入金（給与など）は見込まない（安全側）。同じ口座・同じ日の引き落としは合算する
 */
import { computeBalance, type BalanceAccount, type BalanceEntry } from "@/lib/ledger-balance"
import { addDays, shiftToBusinessDay, toIsoDate, type IsoDate } from "@/lib/jp-holidays"

/** 残高が足りていても、この金額を下回ったら「ぎりぎり」にする（円） */
export const TIGHT_THRESHOLD = 10_000
/** 引き落とし予定を出す先の日数 */
export const WITHDRAWAL_HORIZON_DAYS = 30

export interface CardSetting {
    /** 締め日（1〜31） */
    closingDay: number
    /** 引き落とし日（1〜31） */
    paymentDay: number
    /** 引き落とし日が締め日の何か月後か（0=当月・1=翌月・2=翌々月） */
    paymentMonthOffset: number
}

export interface CardAccount extends BalanceAccount, CardSetting {
    name: string
    withdrawalAccountId: number
}

export interface BankAccount extends BalanceAccount {
    name: string
}

export type WithdrawalStatus = "ok" | "tight" | "shortage"

export interface WithdrawalItem {
    cardId: number
    cardName: string
    closingDate: IsoDate
    paymentDate: IsoDate
    /** 推計の引き落とし額（円。常に正） */
    amount: number
}

export interface WithdrawalGroup {
    bankId: number
    bankName: string
    paymentDate: IsoDate
    items: WithdrawalItem[]
    /** この日に引き落とされる額の合計 */
    total: number
    /** 引き落とし口座の今の残高 */
    balance: number
    /** この日の引き落とし後の見込み残高（それ以前の予定も引いた値）。負なら不足 */
    remaining: number
    status: WithdrawalStatus
}

/** 月の日数 */
function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** `day` が月末より後なら月末に丸めた日付 */
export function clampedDate(year: number, month: number, day: number): IsoDate {
    return toIsoDate(year, month, Math.min(day, daysInMonth(year, month)))
}

/** 年月（month は 1〜12）を `delta` か月ずらす */
function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
    const index = year * 12 + (month - 1) + delta
    return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

export interface CardCycle {
    closingDate: IsoDate
    paymentDate: IsoDate
}

/** `closing` の月に締める請求サイクル。引き落とし日は休日なら翌営業日へ送る */
export function cycleOfClosingMonth(setting: CardSetting, year: number, month: number): CardCycle {
    const closingDate = clampedDate(year, month, setting.closingDay)
    const paid = shiftMonth(year, month, setting.paymentMonthOffset)
    const paymentDate = shiftToBusinessDay(clampedDate(paid.year, paid.month, setting.paymentDay), 1)
    return { closingDate, paymentDate }
}

/** `today` から `horizonDays` 日以内（両端を含む）に引き落とされるサイクル。引き落とし日の順 */
export function upcomingCycles(setting: CardSetting, today: IsoDate, horizonDays = WITHDRAWAL_HORIZON_DAYS): CardCycle[] {
    const end = addDays(today, horizonDays)
    const year = Number(today.slice(0, 4))
    const month = Number(today.slice(5, 7))
    const cycles: CardCycle[] = []
    // 引き落としは締め日の最大2か月後。今日より前に締まったサイクルも拾うため、数か月前から見る
    for (let delta = -3; delta <= 2; delta++) {
        const m = shiftMonth(year, month, delta)
        const cycle = cycleOfClosingMonth(setting, m.year, m.month)
        if (cycle.paymentDate >= today && cycle.paymentDate <= end) cycles.push(cycle)
    }
    return cycles.sort((a, b) => (a.paymentDate < b.paymentDate ? -1 : a.paymentDate > b.paymentDate ? 1 : 0))
}

/** 締め日の翌日から `today`（含む）までの、カード口座への入金の合計（繰上げ返済・引き落としの済んだ分） */
function creditsAfter(card: BalanceAccount, entries: readonly BalanceEntry[], closingDate: IsoDate, today: IsoDate): number {
    let sum = 0
    for (const entry of entries) {
        if (entry.toAccountId !== card.id) continue
        if (card.openingDate && entry.date < card.openingDate) continue
        if (entry.date > closingDate && entry.date <= today) sum += entry.amount
    }
    return sum
}

/**
 * カード1枚の、窓の中の引き落とし予定。額は推計（先頭のコメント参照）。0円のサイクルは出さない。
 */
export function cardWithdrawals(card: CardAccount, entries: readonly BalanceEntry[], today: IsoDate, horizonDays = WITHDRAWAL_HORIZON_DAYS): WithdrawalItem[] {
    const items: WithdrawalItem[] = []
    let scheduled = 0
    for (const cycle of upcomingCycles(card, today, horizonDays)) {
        // 今日より後の取引はまだ起きていないので数えない
        const asOf = cycle.closingDate < today ? cycle.closingDate : today
        const unpaidAtClosing = -computeBalance(card, entries, asOf) - creditsAfter(card, entries, cycle.closingDate, today)
        const amount = Math.max(0, unpaidAtClosing - scheduled)
        scheduled += amount
        if (amount > 0) items.push({ cardId: card.id, cardName: card.name, closingDate: cycle.closingDate, paymentDate: cycle.paymentDate, amount })
    }
    return items
}

export function withdrawalStatus(remaining: number): WithdrawalStatus {
    if (remaining < 0) return "shortage"
    return remaining < TIGHT_THRESHOLD ? "tight" : "ok"
}

/**
 * 引き落とし口座ごと・日ごとの予定と残高の判定。日付の順。
 * `cards` は引き落とし先が決まっているカードだけ、`banks` は引き落とし先になりうる口座。
 */
export function planWithdrawals(
    cards: readonly CardAccount[],
    banks: readonly BankAccount[],
    entries: readonly BalanceEntry[],
    today: IsoDate,
    horizonDays = WITHDRAWAL_HORIZON_DAYS
): WithdrawalGroup[] {
    const bankById = new Map(banks.map((b) => [b.id, b]))
    const byBank = new Map<number, WithdrawalItem[]>()
    for (const card of cards) {
        if (!bankById.has(card.withdrawalAccountId)) continue
        const items = cardWithdrawals(card, entries, today, horizonDays)
        if (items.length === 0) continue
        byBank.set(card.withdrawalAccountId, [...(byBank.get(card.withdrawalAccountId) ?? []), ...items])
    }

    const groups: WithdrawalGroup[] = []
    for (const [bankId, items] of byBank) {
        const bank = bankById.get(bankId) as BankAccount
        const balance = computeBalance(bank, entries, today)
        const dates = [...new Set(items.map((i) => i.paymentDate))].sort()
        let committed = 0
        for (const paymentDate of dates) {
            const dayItems = items.filter((i) => i.paymentDate === paymentDate)
            const total = dayItems.reduce((sum, i) => sum + i.amount, 0)
            committed += total
            const remaining = balance - committed
            groups.push({ bankId, bankName: bank.name, paymentDate, items: dayItems, total, balance, remaining, status: withdrawalStatus(remaining) })
        }
    }
    return groups.sort((a, b) => (a.paymentDate < b.paymentDate ? -1 : a.paymentDate > b.paymentDate ? 1 : a.bankId - b.bankId))
}

/** 全体の判定。1件でも不足があれば shortage、なければ tight があれば tight、なければ ok */
export function overallStatus(groups: readonly WithdrawalGroup[]): WithdrawalStatus {
    if (groups.some((g) => g.status === "shortage")) return "shortage"
    return groups.some((g) => g.status === "tight") ? "tight" : "ok"
}
