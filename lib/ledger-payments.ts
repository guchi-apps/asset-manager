/**
 * 支払いを分けた支出（Issue #944）。DBに触らない純粋な関数だけを置く。
 *
 * - 1つの支出を、複数の口座（カード＋ポイント、現金＋PayPayなど）に分けて払った形を `LedgerPayment` で持つ。
 *   分けていない取引は支払いの行を持たず、今までどおり出金元（`fromAccountId`）だけで残高を動かす
 * - 分けた取引の `fromAccountId` は「代表の口座」。反映待ちならカード明細を待っている口座、そうでなければ先頭の口座。
 *   一覧の表示・口座の絞り込み・カード明細との照合はこの口座を手がかりにする
 * - 反映待ちにできるのは、分けた口座のうち明細が届く口座がちょうど1つのとき。カード明細とはその口座の分の金額で照合し、
 *   確定するとその分の金額だけをカード明細の値にする（ほかの支払いはそのまま。取引の金額は合計に直す）
 *
 * 持ち方と、取引を消す・付け替える経路は `docs/ledger-split-payments.md`。
 */

/** 1つの取引に分けられる支払いの数 */
export const PAYMENTS_MAX = 10

export interface PaymentPart {
    accountId: number
    amount: number
}

export interface PaymentInput {
    accountId?: unknown
    amount?: unknown
}

export type PaymentParseResult = { ok: true; value: PaymentPart[] } | { ok: false; error: string }

function parsePositiveId(value: unknown): number | null {
    if (value === null || value === undefined || value === "" || value === "none") return null
    const n = Number(value)
    return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * 画面から送られた支払いの行を読む。空の配列・未指定なら分けていない（空配列を返す）。
 * 口座も金額も空の行は、足しただけの空行として読み飛ばす。分けるなら2行以上・各行1円以上・口座の重複なし・合計が取引の金額と一致。
 * `parseYen` は呼び出し側から渡す（`lib/ledger-input.ts` との循環を避ける）。
 */
export function parsePayments(raw: unknown, amount: number, parseYen: (value: unknown) => number | null): PaymentParseResult {
    if (!Array.isArray(raw) || raw.length === 0) return { ok: true, value: [] }
    const parts: PaymentPart[] = []
    for (const [index, row] of (raw as PaymentInput[]).entries()) {
        const accountId = parsePositiveId(row?.accountId)
        const empty = row?.amount === undefined || row?.amount === null || row?.amount === ""
        if (accountId === null && empty) continue
        if (accountId === null) return { ok: false, error: `支払いの${index + 1}行目の口座を選んでください` }
        const value = parseYen(row?.amount)
        if (value === null || value <= 0) return { ok: false, error: `支払いの${index + 1}行目の金額は1円以上の整数で入力してください` }
        parts.push({ accountId, amount: value })
    }
    if (parts.length === 0) return { ok: true, value: [] }
    if (parts.length < 2) return { ok: false, error: "支払いを分けるときは、口座を2つ以上入れてください" }
    if (parts.length > PAYMENTS_MAX) return { ok: false, error: `支払いは${PAYMENTS_MAX}口座までに分けられます` }
    if (new Set(parts.map((p) => p.accountId)).size !== parts.length) {
        return { ok: false, error: "同じ口座を2回選んでいます。金額をまとめてください" }
    }
    if (amount <= 0) return { ok: false, error: "マイナス金額の取引は支払いを分けられません" }
    const sum = sumPayments(parts)
    if (sum !== amount) {
        return {
            ok: false,
            error: `支払いの合計（${sum.toLocaleString("ja-JP")}円）が金額（${amount.toLocaleString("ja-JP")}円）と一致しません`,
        }
    }
    return { ok: true, value: parts }
}

export function sumPayments(parts: readonly { amount: number }[]): number {
    return parts.reduce((acc, p) => acc + p.amount, 0)
}

export type PrimaryAccountResult = { ok: true; accountId: number } | { ok: false; error: string }

/**
 * 分けた支払いの代表の口座（`fromAccountId` に入れる口座）。
 * 反映待ちなら、明細が届く口座がちょうど1つでなければならず、その口座を代表にする。確定なら先頭の口座。
 */
export function primaryPaymentAccount(
    parts: readonly PaymentPart[],
    pending: boolean,
    hasStatementFeed: (accountId: number) => boolean
): PrimaryAccountResult {
    if (!pending) return { ok: true, accountId: parts[0].accountId }
    const feeds = parts.filter((p) => hasStatementFeed(p.accountId))
    if (feeds.length === 0) {
        return { ok: false, error: "反映待ちにするには、明細が届く口座（カードなど）を支払いに入れてください" }
    }
    if (feeds.length > 1) {
        return { ok: false, error: "支払いを分けた取引で反映待ちにできるのは、明細が届く口座が1つのときだけです" }
    }
    return { ok: true, accountId: feeds[0].accountId }
}

/**
 * カード明細と照合するときの金額。分けた取引は、代表の口座（待っている口座）の分だけ。分けていなければ取引の金額。
 */
export function statementMatchAmount(entry: {
    amount: number
    fromAccountId: number | null
    payments?: readonly PaymentPart[] | null
}): number {
    const payments = entry.payments ?? []
    if (payments.length === 0) return entry.amount
    return payments.find((p) => p.accountId === entry.fromAccountId)?.amount ?? entry.amount
}

/**
 * カード明細で確定するときの支払い。`accountId` の分をカード明細の金額にし、取引の金額をその合計に直す。
 * 分けていない取引（支払いが空）なら、取引の金額はカード明細の金額のまま。
 */
export function applyStatementToPayments(
    payments: readonly PaymentPart[],
    accountId: number,
    statementAmount: number
): { payments: PaymentPart[]; amount: number } {
    if (payments.length === 0) return { payments: [], amount: statementAmount }
    const next = payments.map((p) => (p.accountId === accountId ? { ...p, amount: statementAmount } : { ...p }))
    if (!next.some((p) => p.accountId === accountId)) next.unshift({ accountId, amount: statementAmount })
    return { payments: next, amount: sumPayments(next) }
}

/** その口座が払った分（分けていない取引は出金元なら全額）。出金元でも支払いの口座でもなければ 0 */
export function paidByAccount(
    accountId: number,
    entry: { amount: number; fromAccountId: number | null; payments?: readonly PaymentPart[] | null }
): number {
    const payments = entry.payments ?? []
    if (payments.length > 0) return sumPayments(payments.filter((p) => p.accountId === accountId))
    return entry.fromAccountId === accountId ? entry.amount : 0
}
