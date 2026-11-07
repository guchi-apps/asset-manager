/**
 * 定期払いの詳細に出す「支払い履歴」（Issue #992）。家計簿の取引のうち、サブスクを紐付けた支出（`LedgerEntry.subscriptionId`）から作る。
 * DBに触らない純粋な関数だけを置く。取得は `lib/ledger-subscription-service.ts` の `loadSubscriptionPayments`。
 */

/** 最初に出す件数。残りは「すべて表示」で取る */
export const PAYMENT_PREVIEW_LIMIT = 12

export interface SubscriptionPaymentRow {
    id: number
    /** JSTの `YYYY-MM-DD` */
    date: string
    /** 相手先。取引の相手先 → 後払いの相手 → 品目名の順で最初にあるもの。無ければ空文字 */
    place: string
    /** 出金元の口座の表示名。口座を持たない取引は null */
    accountName: string | null
    amount: number
}

export interface SubscriptionPaymentsView {
    count: number
    total: number
    latestDate: string | null
    rows: SubscriptionPaymentRow[]
    /** 表示した件数より多く紐付いている（「すべて表示」で残りを取る） */
    hasMore: boolean
}

export interface PaymentSourceRow {
    id: number
    date: string
    amount: number
    place: string | null
    counterparty: string | null
    fromAccount: { name: string; shortName: string | null } | null
    lines: Array<{ name: string }>
}

export function pickPaymentPlace(row: Pick<PaymentSourceRow, "place" | "counterparty" | "lines">): string {
    const candidates = [row.place, row.counterparty, ...row.lines.map((line) => line.name)]
    for (const value of candidates) {
        const trimmed = value?.trim()
        if (trimmed) return trimmed
    }
    return ""
}

/**
 * 取得した行を表示用に整える。`rows` は新しい順で、全件でなければ `PAYMENT_PREVIEW_LIMIT + 1` 件まで取っておく
 * （1件多く取れたかで、続きがあるかを判定する）。`count`・`total`・`latestDate` は取得件数に依らない集計。
 */
export function buildPaymentsView(
    rows: PaymentSourceRow[],
    aggregate: { count: number; total: number; latestDate: string | null },
    all: boolean
): SubscriptionPaymentsView {
    const shown = all ? rows : rows.slice(0, PAYMENT_PREVIEW_LIMIT)
    return {
        count: aggregate.count,
        total: aggregate.total,
        latestDate: aggregate.latestDate,
        rows: shown.map((row) => ({
            id: row.id,
            date: row.date,
            place: pickPaymentPlace(row),
            accountName: row.fromAccount ? (row.fromAccount.shortName?.trim() || row.fromAccount.name) : null,
            amount: row.amount,
        })),
        hasMore: !all && aggregate.count > shown.length,
    }
}
