/**
 * レシート・メールを既存の取引に付けるとき、何が変わるかを組み立てる（Issue #947）。
 *
 * 付ける処理（`attachReceiptToEntry`）と、付ける前のプレビュー画面が同じ判定を使う。画面に出した変更前後と、
 * 実際に書き換わる内容がずれないよう、判定はここの純粋関数に集める。
 * 変えられる項目は品目・店名・口座の3つ。金額と日付は正であるカード明細のままで、選べない。
 */
import type { EvidenceKind } from "@/lib/ledger-match"

/** 品目の合計をカード明細の金額に合わせる差額の行の名前 */
export const AMOUNT_GAP_LINE_NAME = "カード明細との差額"

export type AttachField = "lines" | "place" | "account"

/** 項目ごとに「変更する」か。キーが無ければ既定（`defaultOn`）に従う */
export type AttachSelection = Record<AttachField, boolean>

export interface AttachLine {
    name: string
    amount: number
}

export interface AttachPlanInput {
    entry: { place: string | null; amount: number; fromAccountId: number | null; status: string; lines: readonly AttachLine[] }
    receipt: { storeName: string | null }
    /** レシート・メールの商品を品目にしたもの（差額の行は含まない） */
    receiptLines: readonly AttachLine[]
    kind: EvidenceKind
    /** 付ける側が選んだ支払い口座。決まっていなければ null */
    account: { id: number; name: string } | null
    /** いまの取引の口座名。口座未定なら null */
    entryAccountName: string | null
}

export interface AttachPlan {
    lines: { changes: boolean; defaultOn: boolean; before: AttachLine[]; after: AttachLine[] }
    place: { changes: boolean; defaultOn: boolean; before: string | null; after: string | null }
    account: { changes: boolean; defaultOn: boolean; before: string | null; after: string | null }
}

/** 品目を置き換えるか。レシートは品目の正（#814）。メールは、付け先が代表の1行しか持っていないときだけ */
export function replacesLines(kind: EvidenceKind, entryLineCount: number): boolean {
    return kind === "receipt" || entryLineCount <= 1
}

/** 口座未定の反映待ちの取引に、口座の決まったレシートを付けるとき、その口座にする */
export function assignsAccount(entry: { fromAccountId: number | null; status: string }, account: { id: number } | null): boolean {
    return entry.fromAccountId == null && entry.status === "PENDING_STATEMENT" && account != null
}

export function planAttach(input: AttachPlanInput): AttachPlan {
    const { entry, receipt, receiptLines, kind, account } = input
    const replace = replacesLines(kind, entry.lines.length)
    const after: AttachLine[] = receiptLines.map((l) => ({ name: l.name, amount: l.amount }))
    // 金額が近いだけの取引へ付けたときは、正であるカード明細の金額に品目の合計を合わせる
    const gap = entry.amount - after.reduce((acc, l) => acc + l.amount, 0)
    if (replace && gap !== 0) after.push({ name: AMOUNT_GAP_LINE_NAME, amount: gap })

    const storeName = receipt.storeName?.slice(0, 191) ?? null
    const assign = assignsAccount(entry, account)
    return {
        lines: {
            changes: replace,
            defaultOn: true,
            before: entry.lines.map((l) => ({ name: l.name, amount: l.amount })),
            after: replace ? after : entry.lines.map((l) => ({ name: l.name, amount: l.amount })),
        },
        place: {
            changes: storeName != null && storeName !== entry.place,
            // すでに店名が入っているときは上書きしない（従来どおり）。人が「変更する」を選んだときだけ上書きする
            defaultOn: entry.place == null,
            before: entry.place,
            after: storeName,
        },
        account: {
            changes: assign,
            defaultOn: true,
            before: input.entryAccountName,
            after: assign ? (account?.name ?? null) : input.entryAccountName,
        },
    }
}

/** 画面から渡された選択を、実際に書き換える項目にする。変わらない項目は常に false、指定の無い項目は既定に従う */
export function resolveSelection(plan: AttachPlan, requested?: Partial<AttachSelection>): AttachSelection {
    const pick = (field: AttachField) => plan[field].changes && (requested?.[field] ?? plan[field].defaultOn)
    return { lines: pick("lines"), place: pick("place"), account: pick("account") }
}

/** 画面から来た選択を読む。真偽値以外は捨てる（未指定は既定に従う） */
export function parseSelection(value: unknown): Partial<AttachSelection> {
    if (typeof value !== "object" || value === null) return {}
    const out: Partial<AttachSelection> = {}
    for (const field of ["lines", "place", "account"] as const) {
        const v = (value as Record<string, unknown>)[field]
        if (typeof v === "boolean") out[field] = v
    }
    return out
}

/** プレビューを出した時点の取引の更新時刻。確定時に照合し、別の操作で変わっていたら止める */
export function updatedAtMatches(expected: string | undefined, actual: Date): boolean {
    if (expected === undefined) return true
    const t = new Date(expected).getTime()
    return Number.isFinite(t) && t === actual.getTime()
}
