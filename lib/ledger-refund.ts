/**
 * 返金と支払い明細の紐づけ（Issue #1259）。DBに触らない純粋な関数だけを置く。
 * 返金は `LedgerEntry.refundOfEntryId` で元の支払い（支出の取引）を指す。印を付けるだけで、金額・集計は変えない。
 * DBを使う処理（候補の検索・読み出し・解除）は `lib/ledger-refund-service.ts`。
 */

/** 返金元を付けられる取引か。マイナスの支出、または収入（カードの返金を収入で登録する運用がある） */
export function isRefundAmount(kind: string, amount: number): boolean {
    return (kind === "EXPENSE" && amount < 0) || (kind === "INCOME" && amount > 0)
}

/** 返金額（円・正の数）。返金でなければ 0 */
export function refundAmountOf(kind: string, amount: number): number {
    if (!isRefundAmount(kind, amount)) return 0
    return Math.abs(amount)
}

/** 返金元にできる取引か。プラスの金額の支出だけ */
export function isRefundTarget(kind: string, amount: number): boolean {
    return kind === "EXPENSE" && amount > 0
}

/** 元の支払いから、紐づいた返金を引いた実質の負担額。返金が支払いを超えても 0 未満にしない */
export function netBurden(paid: number, refunds: readonly number[]): number {
    const total = refunds.reduce((acc, v) => acc + v, 0)
    return Math.max(0, paid - total)
}

export interface RefundCandidateSource {
    id: number
    date: string
    place: string | null
    amount: number
}

function normalizePlace(value: string | null): string {
    return (value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "")
}

function dayNumber(day: string): number {
    const [y, m, d] = day.split("-").map(Number)
    return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

/**
 * 返金元の候補を並べる。同じ店を先に、次に返金額以上の支払い、次に返金の日付以前で近いもの。
 * 返金より後に払ったものも出すが、同じ条件なら前のものを優先する。
 */
export function rankRefundCandidates<T extends RefundCandidateSource>(
    refund: { date: string; place: string | null; amount: number },
    candidates: readonly T[],
    limit: number
): (T & { sameStore: boolean })[] {
    const place = normalizePlace(refund.place)
    const refundDay = dayNumber(refund.date)
    return candidates
        .map((c) => {
            const sameStore = place !== "" && normalizePlace(c.place) === place
            const enough = c.amount >= refund.amount
            const diff = refundDay - dayNumber(c.date)
            return { c: { ...c, sameStore }, sameStore, enough, distance: diff >= 0 ? diff : 10_000 - diff }
        })
        .sort(
            (a, b) =>
                Number(b.sameStore) - Number(a.sameStore) ||
                Number(b.enough) - Number(a.enough) ||
                a.distance - b.distance ||
                b.c.id - a.c.id
        )
        .slice(0, limit)
        .map((x) => x.c)
}
