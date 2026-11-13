/**
 * 収入を「他の手段で相殺した」振替へ置き換える入力の組み立て（Issue #1343）。
 *
 * 現金収入を先に収入で記録したあと、実際は現金を受け取らず別の口座で支払い済みだったと分かったときに使う。
 * 収入の入金先（現金）を振替元、選んだ口座を振替先にした同日・同額の振替へ、既存の取引を1回の更新で書き換える。
 * 新規作成＋削除に分けると片方だけ成功する経路ができるので、必ず `updateEntryAction` 1回で済ませる。
 */
import { parseYen, type EntryInput } from "@/lib/ledger-input"

export interface OffsetSource {
    date: string
    amount: unknown
    /** 収入の入金先（現金など）の口座 id。未選択は null・空文字 */
    toAccountId: unknown
    memo: string
}

export type OffsetResult = { ok: true; input: EntryInput } | { ok: false; error: string }

/** 振替のメモ。元のメモは残し、相殺で作ったことを1行足す */
export function offsetMemo(memo: string, amount: number): string {
    const note = `収入から相殺（元の収入: ${amount.toLocaleString("ja-JP")}円）`
    const base = memo.trim()
    return base === "" ? note : `${base}\n${note}`
}

export function buildOffsetTransfer(source: OffsetSource, offsetAccountId: unknown): OffsetResult {
    const amount = parseYen(source.amount)
    if (amount === null || amount <= 0) return { ok: false, error: "振替にできるのは1円以上の収入です" }
    const from = String(source.toAccountId ?? "").trim()
    if (from === "" || !/^\d+$/.test(from)) return { ok: false, error: "入金先の口座が決まっていない収入は振替にできません" }
    const to = String(offsetAccountId ?? "").trim()
    if (to === "" || !/^\d+$/.test(to)) return { ok: false, error: "相殺先の口座を選んでください" }
    if (from === to) return { ok: false, error: "入金先と同じ口座は相殺先にできません" }
    return {
        ok: true,
        input: {
            kind: "TRANSFER",
            status: "CONFIRMED",
            date: source.date,
            amount: String(amount),
            fromAccountId: from,
            toAccountId: to,
            place: "",
            memo: offsetMemo(source.memo, amount),
            excludeFromTotals: false,
            special: false,
            lines: [],
            advances: [],
            payments: [],
        },
    }
}
