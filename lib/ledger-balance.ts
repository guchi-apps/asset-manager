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
