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
 *   同じ口座・同じ日の引き落としは合算する
 * - カード会社のメールなどで確定した額（`ConfirmedWithdrawal`）があるサイクルは、推計の代わりにその額を使う（#1446）。
 *   確定額のぶんだけ次のサイクルの推計から引く（推計どうしと同じ扱い）
 * - 将来の入金は、給与だけを見込む（#1170）。口座ごとに、直近3か月の給料日前後に入った収入取引から
 *   給与額を推定し（保守的に最小値）、今日より後の給料日以降の引き落としの判定へ加える。
 *   実績が足りない口座・給料日と合わない口座には加えない（従来どおり厳しい判定）
 * - 引き落としがすでに済んだサイクル（#1653）: 引き落とし口座からそのカードへの確定済みの振替が、引き落とし日の前後7日・
 *   締め日より後・今日以前にあれば、その額を済み額とし、残り（請求額 − 済み額）だけを口座の判定に使う。
 *   口座の残高は振替を反映した後の値なので、請求額をそのまま引くと二重に引いてしまう
 */
import { computeBalance, type BalanceAccount, type BalanceEntry } from "@/lib/ledger-balance"
import { addDays, shiftToBusinessDay, toIsoDate, type IsoDate } from "@/lib/jp-holidays"
import { paydayOfMonth, type PaydaySettings } from "@/lib/pay-period"

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

/**
 * 引き落としの判定に使う取引。`kind`・`status` は引き落とし済みの振替を見分けるのに使う（#1653）。
 * 省略された取引は引き落としの振替とみなさない
 */
export interface WithdrawalEntry extends BalanceEntry {
    kind?: string | null
    status?: string | null
}

export interface WithdrawalItem {
    cardId: number
    cardName: string
    closingDate: IsoDate
    paymentDate: IsoDate
    /** これから引き落とされる額（円。0以上）。請求額から引き落とし済みの額を引いた残り。口座の判定に使う */
    amount: number
    /** 請求額（円）。確定額があればそれ、無ければ引き落としの振替の額、それも無ければ推計 */
    billedAmount: number
    /** 引き落とし済みの額（円）。引き落とし口座からこのカードへの振替のうち、このサイクルに当たったものの合計 */
    paidAmount: number
    /** 推計の請求額（確定額があっても算出する。食い違いの確認用）。引き落とし済みの振替は差し引く前の額 */
    estimatedAmount: number
    /** 確定額の行の id。推計のままなら null */
    confirmationId: number | null
}

/** 確定した引き落とし額（Issue #1446）。`paymentDate` は休日送り後の実際の日 */
export interface ConfirmedWithdrawal {
    id: number
    cardId: number
    paymentDate: IsoDate
    amount: number
}

/** 確定額をサイクルに当てるときに許す、引き落とし日のずれ（日）。設定の引き落とし日が実際と少し違っても当たるように */
export const CONFIRMATION_MATCH_TOLERANCE_DAYS = 7

export interface WithdrawalGroup {
    bankId: number
    bankName: string
    paymentDate: IsoDate
    items: WithdrawalItem[]
    /** この日に引き落とされる額の合計 */
    total: number
    /** 引き落とし口座の今の残高 */
    balance: number
    /** この日の引き落とし後の見込み残高（それ以前の予定も引き、給与の見込みを加えた値）。負なら不足 */
    remaining: number
    /** 給与の見込みを加えた額。加えていなければ 0 */
    salaryCredit: number
    /** 加えた給与の入金日。加えていなければ null */
    salaryDate: IsoDate | null
    /** 給与の見込みを加えなかった場合の見込み残高 */
    remainingWithoutSalary: number
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

/** 引き落とし口座からカードへの、確定済みの振替か（引き落としそのもの、または同じ口座からの繰上げ返済） */
function isWithdrawalTransfer(card: CardAccount, entry: WithdrawalEntry): boolean {
    return entry.kind === "TRANSFER" && entry.status === "CONFIRMED" && entry.fromAccountId === card.withdrawalAccountId && entry.toAccountId === card.id
}

/**
 * カード1枚の、窓の中の引き落とし予定。額は推計（先頭のコメント参照）。0円のサイクルは出さない。
 * `confirmed` のうち、このカードでサイクルの引き落とし日から前後7日以内のものがあれば、その額と日付を使う
 * （0円でも確定なら出す）。どのサイクルにも当たらない確定額は無視する（呼び出し側で別に扱う）。
 * 引き落とし口座からの確定済みの振替が引き落とし日の前後7日・締め日より後・今日以前にあれば、引き落とし済みとして
 * 残りだけを `amount` にする（済みのサイクルは残りが0でも出す。#1653）。
 */
export function cardWithdrawals(
    card: CardAccount,
    entries: readonly WithdrawalEntry[],
    today: IsoDate,
    horizonDays = WITHDRAWAL_HORIZON_DAYS,
    confirmed: readonly ConfirmedWithdrawal[] = []
): WithdrawalItem[] {
    const own = confirmed.filter((c) => c.cardId === card.id)
    const used = new Set<number>()
    const usedTransfers = new Set<WithdrawalEntry>()
    const items: WithdrawalItem[] = []
    let scheduled = 0
    for (const cycle of upcomingCycles(card, today, horizonDays)) {
        const match = own
            .filter((c) => !used.has(c.id) && dayDiff(c.paymentDate, cycle.paymentDate) <= CONFIRMATION_MATCH_TOLERANCE_DAYS)
            .sort((a, b) => dayDiff(a.paymentDate, cycle.paymentDate) - dayDiff(b.paymentDate, cycle.paymentDate))[0]
        if (match) used.add(match.id)
        const paymentDate = match ? match.paymentDate : cycle.paymentDate
        // 引き落とし済みの振替。締め日より後・今日以前なので、必ず creditsAfter に含まれ、締め日時点の残高には含まれない
        const paidTransfers = entries.filter(
            (e) =>
                !usedTransfers.has(e) &&
                isWithdrawalTransfer(card, e) &&
                !(card.openingDate && e.date < card.openingDate) &&
                e.date > cycle.closingDate &&
                e.date <= today &&
                dayDiff(e.date, paymentDate) <= CONFIRMATION_MATCH_TOLERANCE_DAYS
        )
        for (const e of paidTransfers) usedTransfers.add(e)
        const paidAmount = paidTransfers.reduce((sum, e) => sum + e.amount, 0)
        // 今日より後の取引はまだ起きていないので数えない
        const asOf = cycle.closingDate < today ? cycle.closingDate : today
        const unpaidAtClosing = -computeBalance(card, entries, asOf) - creditsAfter(card, entries, cycle.closingDate, today)
        // 推計は引き落とし済みの振替を差し引く前の額（差し引いたうえで済み額をさらに引くと二重になる）
        const estimatedAmount = Math.max(0, unpaidAtClosing + paidAmount - scheduled)
        const billedAmount = match ? match.amount : paidAmount > 0 ? paidAmount : estimatedAmount
        const amount = Math.max(0, billedAmount - paidAmount)
        // 次のサイクルの推計から引くのは、まだ引き落とされていない残りだけ（済んだ分はカードの残高に反映済み）
        scheduled += amount
        if (amount > 0 || match || paidAmount > 0) {
            items.push({
                cardId: card.id,
                cardName: card.name,
                closingDate: cycle.closingDate,
                paymentDate,
                amount,
                billedAmount,
                paidAmount,
                estimatedAmount,
                confirmationId: match ? match.id : null,
            })
        }
    }
    return items
}

/** 口座への収入取引（給与の推定に使う） */
export interface IncomeEntry {
    date: IsoDate
    amount: number
    toAccountId: number | null
}

export interface SalaryEstimate {
    /** 見込みの給与額（円） */
    amount: number
    /** 次の給料日（今日より後） */
    payDate: IsoDate
}

/** 給料日の前後この日数に入った収入を給与とみなす */
const SALARY_DATE_TOLERANCE_DAYS = 3
/** 給与を推定するのに必要な月数（直近3か月のうち） */
const SALARY_MIN_MONTHS = 2

function dayDiff(a: IsoDate, b: IsoDate): number {
    return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
}

/**
 * 口座 `bankId` の次の給与の見込み。直近3か月それぞれについて、その月の給料日の前後3日に入った収入取引のうち
 * 最大のものを拾い、2か月以上拾えたら最小値を額とする。次の給料日は今日より後のもの（今月分がすでに過ぎていれば
 * 残高に入っているので、二重に数えない）。推定できなければ null。
 */
export function estimateSalary(bankId: number, incomes: readonly IncomeEntry[], today: IsoDate, payday: PaydaySettings): SalaryEstimate | null {
    const year = Number(today.slice(0, 4))
    const month = Number(today.slice(5, 7))
    const amounts: number[] = []
    for (let delta = -3; delta <= -1; delta++) {
        const m = shiftMonth(year, month, delta)
        const payDate = paydayOfMonth(m.year, m.month, payday)
        let best = 0
        for (const e of incomes) {
            if (e.toAccountId !== bankId || e.amount <= 0) continue
            if (dayDiff(e.date, payDate) <= SALARY_DATE_TOLERANCE_DAYS && e.amount > best) best = e.amount
        }
        if (best > 0) amounts.push(best)
    }
    if (amounts.length < SALARY_MIN_MONTHS) return null
    let payDate = paydayOfMonth(year, month, payday)
    if (payDate <= today) {
        const next = shiftMonth(year, month, 1)
        payDate = paydayOfMonth(next.year, next.month, payday)
    }
    return { amount: Math.min(...amounts), payDate }
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
    entries: readonly WithdrawalEntry[],
    today: IsoDate,
    horizonDays = WITHDRAWAL_HORIZON_DAYS,
    salaries: ReadonlyMap<number, SalaryEstimate> = new Map(),
    confirmed: readonly ConfirmedWithdrawal[] = []
): WithdrawalGroup[] {
    const bankById = new Map(banks.map((b) => [b.id, b]))
    const byBank = new Map<number, WithdrawalItem[]>()
    for (const card of cards) {
        if (!bankById.has(card.withdrawalAccountId)) continue
        const items = cardWithdrawals(card, entries, today, horizonDays, confirmed)
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
            const remainingWithoutSalary = balance - committed
            const salary = salaries.get(bankId)
            const credited = salary != null && salary.payDate <= paymentDate
            const salaryCredit = credited ? salary.amount : 0
            const remaining = remainingWithoutSalary + salaryCredit
            groups.push({
                bankId,
                bankName: bank.name,
                paymentDate,
                items: dayItems,
                total,
                balance,
                remaining,
                salaryCredit,
                salaryDate: credited ? salary.payDate : null,
                remainingWithoutSalary,
                // この日の予定がすべて引き落とし済みなら、判定する引き落としが無い（不足の件数に数えない。#1653）
                status: dayItems.every((i) => i.amount === 0 && i.paidAmount > 0) ? "ok" : withdrawalStatus(remaining),
            })
        }
    }
    return groups.sort((a, b) => (a.paymentDate < b.paymentDate ? -1 : a.paymentDate > b.paymentDate ? 1 : a.bankId - b.bankId))
}

/** 全体の判定。1件でも不足があれば shortage、なければ tight があれば tight、なければ ok */
export function overallStatus(groups: readonly WithdrawalGroup[]): WithdrawalStatus {
    if (groups.some((g) => g.status === "shortage")) return "shortage"
    return groups.some((g) => g.status === "tight") ? "tight" : "ok"
}
