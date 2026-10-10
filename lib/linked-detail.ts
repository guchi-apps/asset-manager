/**
 * スマートレシート・Amazon由来の明細の「商品別の内訳」を扱う純粋関数（Issue #663）。
 *
 * Zaim Web版の一覧は、1件の取引に複数商品があっても**先頭の商品名と取引合計**しか返さない。
 * 以前はそれをそのまま1商品として取り込んでいたため、卵以外も買った合計1,543円が
 * 「玉子L6個入 1,543円」になっていた。ここでは次の3つを区別する。
 *
 * - `complete` … 商品別の明細があり、合計が取引合計と一致する
 * - `mismatch` … 商品別の明細はあるが合計が合わない（差額を示す。**特定の商品へ自動で寄せない**）
 * - `missing`  … 商品別の明細が取れていない（代表商品名＋合計だけ。商品明細として扱わない）
 *
 * **合計が一致しただけでは `complete` にならない。** 代表商品に合計を載せた行は必ず合計と一致する
 * ため、商品別の明細が取れていることが先に要る。
 */

/** AIDE（Zaim Web版の取引詳細）から取れた商品1行。取れなかった値は `null`（推測しない）。 */
export interface LinkedDetailItem {
    name: string
    /** 値引き適用後の支払額（円）。 */
    amount: number
    quantity: number | null
    unitPrice: number | null
    /** 値引き額（円・正の数）。 */
    discount: number | null
    /** この商品の税額（円）。 */
    tax: number | null
    categoryName: string | null
    genreName: string | null
}

/** 取り込み時点で取得できた内容。利用者の修正（`ReceiptItem` の現在値）と区別するために残す。 */
export interface LinkedItemSnapshot extends LinkedDetailItem {
    /** `detail` は商品別の明細、`representative` は代表商品名＋取引合計のみ。 */
    kind: "detail" | "representative"
}

export type LinkedDetailState = "complete" | "mismatch" | "missing"

export interface LinkedDetailEvaluation {
    state: LinkedDetailState
    /** 取引合計 − 商品別の合計。`missing` では意味を持たないので 0。 */
    difference: number
}

function toText(value: unknown): string {
    return typeof value === "string" ? value.trim() : ""
}

function toInt(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null
}

/**
 * AIDEの応答の `items` を商品別の明細へ畳む。**純粋関数。**
 *
 * 配列でない・1行も読めない場合は `undefined`（＝詳細を返してこなかった）。名前が空・金額が読めない
 * 行が1つでもあれば、**全体を `undefined` にする**。一部だけ読めた明細を完全なものとして
 * 扱うと、欠けた行ぶんだけ合計がずれて「差額」として現れ、原因の取得失敗が見えなくなるため。
 */
export function parseDetailItems(value: unknown): LinkedDetailItem[] | undefined {
    if (!Array.isArray(value) || value.length === 0) return undefined

    const items: LinkedDetailItem[] = []
    for (const raw of value) {
        const record = raw as Record<string, unknown> | null
        const name = toText(record?.name)
        const amount = toInt(record?.amount)
        if (!name || amount === null) return undefined

        const quantity = typeof record?.quantity === "number" && record.quantity > 0 ? record.quantity : null
        items.push({
            name,
            amount,
            quantity,
            unitPrice: toInt(record?.unitPrice),
            discount: toInt(record?.discount),
            tax: toInt(record?.tax),
            categoryName: toText(record?.category) || null,
            genreName: toText(record?.genre) || null,
        })
    }
    return items
}

/** 取引合計と商品別の明細を突き合わせる。 */
export function evaluateLinkedDetail(
    entryAmount: number,
    items: readonly Pick<LinkedDetailItem, "amount">[] | undefined
): LinkedDetailEvaluation {
    if (!items || items.length === 0) return { state: "missing", difference: 0 }
    const sum = items.reduce((total, item) => total + item.amount, 0)
    const difference = Math.round(entryAmount) - sum
    return { state: difference === 0 ? "complete" : "mismatch", difference }
}

/** 代表商品名＋取引合計だけの行の取得内容。商品別の値は何も持たない。 */
export function representativeSnapshot(name: string, amount: number): LinkedItemSnapshot {
    return {
        kind: "representative",
        name,
        amount,
        quantity: null,
        unitPrice: null,
        discount: null,
        tax: null,
        categoryName: null,
        genreName: null,
    }
}

export function detailSnapshot(item: LinkedDetailItem): LinkedItemSnapshot {
    return { kind: "detail", ...item }
}

/** DBのJSONから取得内容を読み戻す。形が違えば null。 */
export function parseSnapshot(value: unknown): LinkedItemSnapshot | null {
    const record = value as Record<string, unknown> | null
    if (!record || typeof record !== "object") return null
    if (record.kind !== "detail" && record.kind !== "representative") return null
    const name = toText(record.name)
    const amount = toInt(record.amount)
    if (!name || amount === null) return null
    return {
        kind: record.kind,
        name,
        amount,
        quantity: typeof record.quantity === "number" ? record.quantity : null,
        unitPrice: toInt(record.unitPrice),
        discount: toInt(record.discount),
        tax: toInt(record.tax),
        categoryName: toText(record.categoryName) || null,
        genreName: toText(record.genreName) || null,
    }
}

/**
 * 再取得で置き換えてよい行か。**利用者が手を入れた行・登録済みの行は置き換えない。**
 *
 * - 代表商品名＋合計のままの行（`detailMissing`）
 * - 取得内容を記録する前（#663より前）に取り込んだ行で、利用者が分類以外に触っていないもの
 *   （`snapshot` が無く `classifiedBy` が `MANUAL` でない）
 */
export function isRefetchableItem(item: {
    detailMissing: boolean
    sourceZaimMoneyId: unknown
    sourceSnapshot: unknown
    classifiedBy: string
    zaimRegisteredAt: Date | null
}): boolean {
    if (item.zaimRegisteredAt) return false
    if (item.sourceZaimMoneyId === null || item.sourceZaimMoneyId === undefined) return false
    if (item.detailMissing) return true
    return item.sourceSnapshot === null && item.classifiedBy !== "MANUAL"
}
