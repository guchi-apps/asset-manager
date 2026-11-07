/**
 * 家計簿の口座残高（Issue #815）。
 *
 * 残高は `openingBalance` に、`openingDate` 以降の取引を積み上げて出す。Zaimの残高は正にしない
 * （#814の方針）。手で残高を直したときは、差額を残高調整（`ADJUSTMENT`）の取引として残す。
 *
 * 取引の金額は常に正の数で、向きは出金元（減る）・入金先（増える）で表す。種別は見ない
 * （支出は出金元だけ、収入は入金先だけ、振替・残高調整は両方または片方を持つ）。
 * 支払いを分けた支出（#944）は、出金元ではなく支払いの行ごとにその口座を減らす（`lib/ledger-payments.ts`）。
 */
import { paidByAccount, type PaymentPart } from "@/lib/ledger-payments"


export interface BalanceAccount {
    id: number
    openingBalance: number
    /** JSTの `YYYY-MM-DD`。null なら全取引を積む */
    openingDate: string | null
}

export interface BalanceEntry {
    date: string
    amount: number
    fromAccountId: number | null
    toAccountId: number | null
    /** 支払いを分けた支出の口座ごとの金額（#944）。分けていなければ空・省略 */
    payments?: readonly PaymentPart[] | null
}

/** その取引が口座の残高をいくら動かすか（増えれば正、減れば負） */
export function balanceEffect(accountId: number, entry: BalanceEntry): number {
    let delta = 0
    delta -= paidByAccount(accountId, entry)
    if (entry.toAccountId === accountId) delta += entry.amount
    return delta
}

/**
 * `asOf`（その日を含む）時点の残高。`asOf` を省くと全期間。
 * 初期残高の基準日より前の取引は、初期残高に織り込み済みとして数えない。
 */
export function computeBalance(
    account: BalanceAccount,
    entries: readonly BalanceEntry[],
    asOf?: string
): number {
    let balance = account.openingBalance
    for (const entry of entries) {
        if (account.openingDate && entry.date < account.openingDate) continue
        if (asOf && entry.date > asOf) continue
        balance += balanceEffect(account.id, entry)
    }
    return balance
}

export interface AdjustmentPlan {
    /** 差額の絶対値（円） */
    amount: number
    /** 増やすなら入金先、減らすなら出金元に口座を置く */
    direction: "increase" | "decrease"
}

/** 今の残高を `target` に合わせるための残高調整。差が無ければ null */
export function planBalanceAdjustment(current: number, target: number): AdjustmentPlan | null {
    const diff = target - current
    if (diff === 0) return null
    return { amount: Math.abs(diff), direction: diff > 0 ? "increase" : "decrease" }
}

/** 日末残高の系列（#962）。`start` の日から1日ごとに1件、`balances[i]` が `start` の i 日後の日末残高 */
export interface BalanceSeries {
    /** JSTの `YYYY-MM-DD` */
    start: string
    balances: number[]
    /**
     * 初期残高の基準日が `balances` の何番目か（#1020）。系列が基準日より前から始まるときだけ持ち、
     * それより前の値は基準日の初期残高から取引を逆にたどって出した推定。基準日から始まる・基準日が無いときは null
     */
    openingOffset: number | null
}

function shiftDay(day: string, delta: number): string {
    const [y, m, d] = day.split("-").map(Number)
    return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
    const [fy, fm, fd] = from.split("-").map(Number)
    const [ty, tm, td] = to.split("-").map(Number)
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

/**
 * 口座の日末残高を `today`（その日を含む）まで1日ごとに返す。基準日以降の値は `computeBalance` と一致する。
 * 始点はその口座の残高を動かす最初の取引の日と基準日のうち早いほう（基準日が無ければ最初の取引の日）。
 * 基準日より前の取引は残高（`computeBalance`）では初期残高に織り込み済みとして数えないが、推移では
 * 「基準日の前日の日末残高 = 初期残高」から逆にたどって過去の日末残高を出す（#1020。以前は基準日で切っていた）。
 * `today` より後の取引は含めない（そのため最後の値は、先の日付の取引がある口座では画面の現在残高と一致しないことがある）。
 */
export function computeBalanceSeries(
    account: BalanceAccount,
    entries: readonly BalanceEntry[],
    today: string
): BalanceSeries {
    const deltaByDay = new Map<string, number>()
    let beforeOpening = 0
    for (const entry of entries) {
        const delta = balanceEffect(account.id, entry)
        if (delta === 0) continue
        // 基準日が今日より後の口座でも、基準日の前日の日末残高が初期残高になるよう、今日より後の分も差し引く
        if (account.openingDate && entry.date < account.openingDate) beforeOpening += delta
        if (entry.date > today) continue
        deltaByDay.set(entry.date, (deltaByDay.get(entry.date) ?? 0) + delta)
    }
    let start = account.openingDate ?? today
    for (const day of deltaByDay.keys()) if (day < start) start = day
    if (start > today) start = today
    const balances: number[] = []
    // 基準日より前の取引は、積み終えたときに基準日の前日の日末残高が初期残高になるよう、差し引いた値から積み始める
    let balance = account.openingBalance - beforeOpening
    for (let day = start; day <= today; day = shiftDay(day, 1)) {
        balance += deltaByDay.get(day) ?? 0
        balances.push(balance)
    }
    const openingOffset =
        account.openingDate && start < account.openingDate && account.openingDate <= today
            ? daysBetween(start, account.openingDate)
            : null
    return { start, balances, openingOffset }
}
