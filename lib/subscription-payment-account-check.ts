import { compareDayKey, type DayKey } from "@/lib/subscription-billing"

/**
 * 定期払いに登録した支払い方法の口座と、紐付けた明細の出金元口座が一致するかの照合（Issue #1567）。
 * DBに触らない純粋な関数だけを置く。履歴の取得は `lib/ledger-subscription-service.ts`。
 *
 * 警告を出すだけで、保存・紐付けは止めない。比べるのは `LedgerAccount.id` 同士で、
 * 支払い方法が口座を持たない（口座なし・未設定）、または明細に出金元口座が無いときは判定できないので警告しない。
 */

export interface PaymentAccountRef {
    id: number
    name: string
}

/** 支払い方法の変更履歴1件。口座を持たない支払い方法は `account` が null */
export interface PaymentMethodAccountEntry {
    effectiveFrom: DayKey
    account: PaymentAccountRef | null
}

export interface PaymentAccountMismatch {
    /** 定期払いに登録している支払い方法の口座名 */
    registeredName: string
    /** 明細の出金元の口座名 */
    actualName: string
}

/** その日に適用されていた支払い方法の口座。履歴が空なら null。最初の適用日より前は最古の履歴を使う */
export function registeredAccountAt(history: readonly PaymentMethodAccountEntry[], day: DayKey): PaymentAccountRef | null {
    if (history.length === 0) return null
    const sorted = [...history].sort((a, b) => compareDayKey(a.effectiveFrom, b.effectiveFrom))
    let current = sorted[0]
    for (const entry of sorted) {
        if (compareDayKey(entry.effectiveFrom, day) <= 0) current = entry
    }
    return current.account
}

/** 登録した口座と明細の出金元口座が違うときだけ返す。判定できないとき・一致するときは null */
export function checkPaymentAccount(registered: PaymentAccountRef | null, actual: PaymentAccountRef | null): PaymentAccountMismatch | null {
    if (!registered || !actual) return null
    if (registered.id === actual.id) return null
    return { registeredName: registered.name, actualName: actual.name }
}
