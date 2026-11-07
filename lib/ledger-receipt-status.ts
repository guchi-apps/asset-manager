/**
 * レシート・メールの「家計簿での状態」の判定（Issue #886）。純粋関数だけを置く。
 *
 * 4つの状態（未登録／反映待ち／照合待ち／取引に付けた）に、旧運用でZaimへ登録した行の「旧運用」を足した5つ。
 * 状態は `ReceiptImport.ledgerEntryId` と、付いている取引の状態から導く（保存はしない）。
 * 旧照合の `matchedCard*` は見ない（#886）。
 */

/** 旧運用（Zaimへ登録・置き換え）で進めたレシートの状態。家計簿には付けない（`ledger-receipt-service.ts` と同じ） */
export const LEGACY_RECEIPT_STATUSES = ["SENT_TO_ZAIM", "REPLACED", "MANUAL_ACTION_REQUIRED"] as const

export interface LedgerStateEntry {
    id: number
    status: string
    date: string
    amount: number
    /** 支払った口座の名前。口座未定なら null */
    accountName: string | null
}

export type LedgerReceiptState =
    | { kind: "legacy" }
    | { kind: "unregistered" }
    /** 明細が届く口座の取引で、カード明細がまだ届いていない。口座未定なら `accountName` が null */
    | { kind: "pending"; entryId: number; accountName: string | null }
    /** 同じ金額・日付のカード明細が届いていて、人が確かめるのを待っている */
    | { kind: "matchPending"; entryId: number; accountName: string | null }
    | { kind: "attached"; entryId: number; date: string; amount: number; accountName: string | null }

/**
 * @param matchCandidateEntryIds 照合待ちのカード明細の候補になっている取引のid（`loadMatchReviews` の候補）
 */
export function judgeLedgerState(
    receipt: { status: string; ledgerEntryId: number | null },
    entry: LedgerStateEntry | null,
    matchCandidateEntryIds: ReadonlySet<number>
): LedgerReceiptState {
    if (receipt.ledgerEntryId === null || entry === null) {
        return (LEGACY_RECEIPT_STATUSES as readonly string[]).includes(receipt.status) ? { kind: "legacy" } : { kind: "unregistered" }
    }
    if (entry.status === "MATCH_PENDING") return { kind: "matchPending", entryId: entry.id, accountName: entry.accountName }
    if (entry.status === "PENDING_STATEMENT") {
        return matchCandidateEntryIds.has(entry.id)
            ? { kind: "matchPending", entryId: entry.id, accountName: entry.accountName }
            : { kind: "pending", entryId: entry.id, accountName: entry.accountName }
    }
    return { kind: "attached", entryId: entry.id, date: entry.date, amount: entry.amount, accountName: entry.accountName }
}

/** 一覧の絞り込み。`legacy` は「すべて」にだけ出る */
export type LedgerStateFilter = "all" | "unregistered" | "matchPending" | "pending" | "attached"

const LEDGER_STATE_FILTERS: readonly string[] = ["all", "unregistered", "matchPending", "pending", "attached"] satisfies LedgerStateFilter[]

/** URLの `?filter=` を絞り込みとして受け取ってよいか（#1071） */
export function isLedgerStateFilter(value: string | undefined): value is LedgerStateFilter {
    return value !== undefined && LEDGER_STATE_FILTERS.includes(value)
}

export function matchesLedgerFilter(state: LedgerReceiptState, filter: LedgerStateFilter): boolean {
    return filter === "all" || state.kind === filter
}

/**
 * 一括登録の対象か。#859 より前に取り込んで家計簿に入っていない、メール・外部アプリ・スマートレシート・Amazonのうち、
 * 日付が家計簿の取り込み開始日以降のもの。写真のレシートは口座を人が選ぶので対象にしない。
 * 登録条件（総額・商品の合計など）は登録時に `receiptRegisterBlocker` が確かめる。
 */
export function isBulkRegisterTarget(
    receipt: { source: string; purchasedDate: string | null },
    state: LedgerReceiptState,
    startDate: string | null
): boolean {
    return (
        state.kind === "unregistered" &&
        receipt.source !== "PHOTO" &&
        startDate !== null &&
        receipt.purchasedDate !== null &&
        receipt.purchasedDate >= startDate
    )
}
