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
