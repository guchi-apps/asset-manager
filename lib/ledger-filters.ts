/**
 * 家計簿の一覧の絞り込み（Issue #819）。ホームの「要対応」の件数と、明細の絞り込みの件数を同じ判定にする。
 * サーバー・クライアントの両方から使うので、Prismaに依存させない。
 */

interface FilterableEntry {
    kind: string
    excludeFromTotals: boolean
    lines: { categoryId: number | null }[]
}

/** 品目のどれかがカテゴリ未設定の支出・収入（集計に含めないものは除く） */
export function isUncategorizedEntry(entry: FilterableEntry): boolean {
    if (entry.excludeFromTotals || (entry.kind !== "EXPENSE" && entry.kind !== "INCOME")) return false
    return entry.lines.length === 0 || entry.lines.some((l) => l.categoryId === null)
}

interface TitledEntry {
    kind: string
    place: string | null
    fromAccountName: string | null
    toAccountName: string | null
    lines: { name: string }[]
}

const KIND_LABELS: Record<string, string> = { EXPENSE: "支出", INCOME: "収入", TRANSFER: "振替", ADJUSTMENT: "残高調整" }

/** 一覧に出す取引の名前。振替は「元 → 先」、残高調整は「口座 の残高調整」 */
export function entryTitle(entry: TitledEntry): string {
    if (entry.kind === "TRANSFER") return `${entry.fromAccountName ?? "?"} → ${entry.toAccountName ?? "?"}`
    if (entry.kind === "ADJUSTMENT") return `${entry.toAccountName ?? entry.fromAccountName ?? "?"} の残高調整`
    return entry.place || entry.lines[0]?.name || KIND_LABELS[entry.kind] || "取引"
}

/* ───────────── 明細タイムライン（Issue #855） ───────────── */

interface TotalableEntry {
    kind: string
    status: string
    amount: number
    excludeFromTotals: boolean
}

/**
 * その日の支出の合計。画面上部の支出（`lib/ledger-summary.ts` の `summarizeLedger`）と同じ条件で数える:
 * 照合待ち・集計に含めない・振替・残高調整・収入は入れない。反映待ち（カード明細の到着待ち）は支出に含める。
 */
export function dayExpenseTotal(entries: readonly TotalableEntry[]): number {
    let total = 0
    for (const e of entries) {
        if (e.kind !== "EXPENSE" || e.status === "MATCH_PENDING" || e.excludeFromTotals) continue
        total += e.amount
    }
    return total
}

interface CategoryNode {
    id: number
    name: string
    parentId: number | null
}

/** 品目のカテゴリを「大分類 › 中分類」の文字にする。親が無い（大分類だけ）ものはその名前、見つからなければ null */
export function categoryPathText(categoryId: number | null, categories: ReadonlyMap<number, CategoryNode>): string | null {
    if (categoryId == null) return null
    const category = categories.get(categoryId)
    if (!category) return null
    const parent = category.parentId != null ? categories.get(category.parentId) : undefined
    return parent ? `${parent.name} › ${category.name}` : category.name
}

/**
 * 1件の分類の表示。代表（先頭）の品目の「大分類 › 中分類」を出し、品目が複数なら「 他」を付ける。
 * 先頭の品目がカテゴリ未設定なら未分類（`uncategorized: true`）。
 */
export function entryCategoryText(
    lines: readonly { categoryId: number | null }[],
    categories: ReadonlyMap<number, CategoryNode>
): { text: string; uncategorized: boolean } {
    const first = lines[0]?.categoryId ?? null
    const path = categoryPathText(first, categories)
    if (!path) return { text: "未分類", uncategorized: true }
    return { text: lines.length > 1 ? `${path} 他` : path, uncategorized: false }
}

/** 一覧に出す口座の名前。短縮名があればそれ、無ければ正式名を `max` 文字で省略する */
export function accountDisplayName(account: { name: string; shortName: string | null } | null | undefined, max = 10): string {
    if (!account) return "?"
    const short = account.shortName?.trim()
    if (short) return short
    const chars = [...account.name]
    return chars.length > max ? `${chars.slice(0, max).join("")}…` : account.name
}

const ACCOUNT_DOT_COLORS = ["#2563eb", "#0d9488", "#ca8a04", "#7c3aed", "#db2777", "#16a34a", "#ea580c", "#0891b2"]

/** 口座ごとに固定の印の色（口座IDで決める。同じ口座はいつも同じ色） */
export function accountDotColor(accountId: number | null): string {
    if (accountId == null) return "#9ca3af"
    return ACCOUNT_DOT_COLORS[Math.abs(accountId) % ACCOUNT_DOT_COLORS.length]
}
