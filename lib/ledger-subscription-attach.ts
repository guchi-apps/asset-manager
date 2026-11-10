/**
 * サブスクを既存の取引に紐付けるとき、何が変わるかを組み立てる（Issue #957）。
 *
 * レシート・メール（`lib/ledger-attach-preview.ts`）と同じく、付ける処理と付ける前のプレビュー画面が同じ判定を使う。
 * 変えられる項目は品目（品名）と店名の2つ。金額・日付・カテゴリは取引のままで、選べない。
 * 口座は、サブスクの支払い方法と家計簿の口座に対応が無いので項目に含めない。
 */
import type { AttachLine } from "@/lib/ledger-attach-preview"

export type SubscriptionAttachField = "lines" | "place" | "category"

/** 項目ごとに「変更する」か */
export type SubscriptionAttachSelection = Record<SubscriptionAttachField, boolean>

export const SUBSCRIPTION_ATTACH_FIELDS: readonly SubscriptionAttachField[] = ["lines", "place", "category"]

/** 取引の品目のうち、カテゴリの付け替えの判定に要る項目（Issue #1288） */
export interface SubscriptionAttachEntryLine extends AttachLine {
    categoryId?: number | null
    /** いまのカテゴリの表示名（大分類 › 中分類）。未分類は null */
    categoryLabel?: string | null
    classifiedBy?: string | null
}

export interface SubscriptionAttachPlanInput {
    entry: { place: string | null; lines: readonly SubscriptionAttachEntryLine[] }
    subscriptionName: string
    /** 定期払いに設定された家計簿のカテゴリ（Issue #1288）。未設定・使えないときは null */
    category?: { id: number; label: string } | null
}

export interface SubscriptionAttachPlan {
    lines: { changes: boolean; defaultOn: boolean; before: AttachLine[]; after: AttachLine[] }
    place: { changes: boolean; defaultOn: boolean; before: string | null; after: string | null }
    /** 品目のカテゴリ。品目が1行の取引だけが対象（どの行か決められないため）。手で分類した品目は既定で変えない */
    category: { changes: boolean; defaultOn: boolean; before: string | null; after: string | null; categoryId: number | null }
}

const NAME_MAX = 191

/** 品目の名前を置き換えるか。品目が1行だけの取引で、名前がまだ違うときだけ（複数行は、どの行かが決められない） */
export function replacesLineName(lines: readonly AttachLine[], subscriptionName: string): boolean {
    return lines.length === 1 && lines[0].name !== subscriptionName.slice(0, NAME_MAX)
}

export function planSubscriptionAttach(input: SubscriptionAttachPlanInput): SubscriptionAttachPlan {
    const { entry } = input
    const name = input.subscriptionName.slice(0, NAME_MAX)
    const replace = replacesLineName(entry.lines, name)
    const before = entry.lines.map((l) => ({ name: l.name, amount: l.amount }))
    const only = entry.lines.length === 1 ? entry.lines[0] : null
    const category = input.category ?? null
    const categoryChanges = category !== null && only !== null && only.categoryId !== category.id
    return {
        category: {
            changes: categoryChanges,
            defaultOn: only?.classifiedBy !== "MANUAL",
            before: only?.categoryLabel ?? null,
            after: categoryChanges ? category.label : (only?.categoryLabel ?? null),
            categoryId: categoryChanges ? category.id : null,
        },
        lines: {
            changes: replace,
            defaultOn: true,
            before,
            // 金額は取引のまま。名前だけを置き換える
            after: replace ? [{ name, amount: entry.lines[0].amount }] : before,
        },
        place: {
            changes: name !== "" && name !== entry.place,
            // すでに店名が入っているときは上書きしない。人が「変更する」を選んだときだけ上書きする
            defaultOn: entry.place == null,
            before: entry.place,
            after: name === "" ? null : name,
        },
    }
}

/** 画面から渡された選択を、実際に書き換える項目にする。変わらない項目は常に false、指定の無い項目は既定に従う */
export function resolveSubscriptionSelection(plan: SubscriptionAttachPlan, requested?: Partial<SubscriptionAttachSelection>): SubscriptionAttachSelection {
    const pick = (field: SubscriptionAttachField) => plan[field].changes && (requested?.[field] ?? plan[field].defaultOn)
    return { lines: pick("lines"), place: pick("place"), category: pick("category") }
}

/** 画面から来た選択を読む。真偽値以外は捨てる（未指定は既定に従う） */
export function parseSubscriptionSelection(value: unknown): Partial<SubscriptionAttachSelection> {
    if (typeof value !== "object" || value === null) return {}
    const out: Partial<SubscriptionAttachSelection> = {}
    for (const field of SUBSCRIPTION_ATTACH_FIELDS) {
        const v = (value as Record<string, unknown>)[field]
        if (typeof v === "boolean") out[field] = v
    }
    return out
}
