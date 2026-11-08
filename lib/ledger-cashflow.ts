/**
 * ホームの「今月のお金の動き」（Issue #1177）。期間の集計（`summarizeLedger`）から、
 * 収入 → 支出 → 収支 → 貯蓄・投資へ → 手元に残る額 の流れと、横棒の配分を出す。
 *
 * - `balance`（収支）は `LedgerSummary.balance` と同じ「収入 − 支出」。家計簿の分析画面の「収支」と食い違わせない。
 * - `retained`（手元に残る額）は収支からさらに「貯蓄・投資へ」を引いた額で、`balance` とは別の指標。
 * - 「貯蓄・投資へ」（`toSavings`）に入るのは、入金先が証券口座で集計対象の振替だけ（`lib/ledger-summary.ts`）。
 *   照合待ち（MATCH_PENDING）は収入・支出・振替のいずれにも入らない。
 * - カードの引き落とし予定は含めない（残高不足の確認は `CardWithdrawalBanner` が担う）。
 */

export interface CashflowInput {
    income: number
    expense: number
    toSavings: number
}

export interface Cashflow {
    income: number
    expense: number
    toSavings: number
    /** 収入 − 支出（`LedgerSummary.balance` と同じ） */
    balance: number
    /** 収入 − 支出 − 貯蓄・投資へ */
    retained: number
    /** 収入に対する割合。収入が0なら null */
    rates: { expense: number; savings: number; retained: number } | null
    /**
     * 横棒の幅（0〜1）。棒の全長は「収入」と「支出＋貯蓄・投資」の大きいほう。
     * 出ていったお金が収入を超えた月は、`incomeMark` の位置から右が超過分になる。
     */
    bar: { expense: number; savings: number; retained: number; incomeMark: number | null }
}

export function computeCashflow({ income, expense, toSavings }: CashflowInput): Cashflow {
    const balance = income - expense
    const retained = balance - toSavings
    const outflow = expense + toSavings
    const scale = Math.max(income, outflow)
    const ratio = (value: number) => (scale > 0 ? Math.max(0, value) / scale : 0)
    return {
        income,
        expense,
        toSavings,
        balance,
        retained,
        rates: income > 0 ? { expense: expense / income, savings: toSavings / income, retained: retained / income } : null,
        bar: {
            expense: ratio(expense),
            savings: ratio(toSavings),
            retained: ratio(retained),
            incomeMark: retained < 0 && scale > 0 ? income / scale : null,
        },
    }
}

/** 0.364 → "36%"。小さすぎて0%に見えても値があるときは "1%未満" にする */
export function formatRate(rate: number): string {
    const percent = Math.round(rate * 100)
    if (percent === 0 && rate > 0) return "1%未満"
    return `${percent}%`
}
