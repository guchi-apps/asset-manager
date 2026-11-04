/**
 * 家計簿の期間ごとの集計（Issue #815）。
 *
 * - 支出・収入は「集計に含めない」を除いた支出・収入の取引だけを足す。
 * - 反映待ち（カード明細との対応がまだ）の支出も支出に含め、別に「うち反映待ち」を出す（#814の方針）。
 * - 振替は収支に入れない。証券口座への振替だけ「貯蓄・投資へ」として別に出す。
 * - 残高調整は収支に入れず、増減を別枠で出す。
 * - 照合待ち（MATCH_PENDING。#818）は、同じ支払いか決まるまで収支にもカテゴリ別にも入れない。
 * - カテゴリ別は品目（`LedgerLine`）単位で数える。品目の無い取引は全額を未分類にする。
 * - 「特別な支出」の印（#835）が付いた取引も期間の支出・収入に含め、別に「うち特別な支出」を出す。
 *   月の推移・平均ではこれを除く（`regularExpense`）。
 * - 「会社関係を除いて見る」（#835）では、会社関係のカテゴリ（大分類に付けた属性は中分類にも効く）の品目を
 *   支出・収入から外す。
 */

export type SummaryEntryKind = "EXPENSE" | "INCOME" | "TRANSFER" | "ADJUSTMENT"

export interface SummaryLine {
    amount: number
    categoryId: number | null
}

export interface SummaryEntry {
    kind: SummaryEntryKind
    status: "CONFIRMED" | "PENDING_STATEMENT" | "MATCH_PENDING"
    amount: number
    excludeFromTotals: boolean
    toAccountId: number | null
    /** 入金先の口座の役割（`LedgerAccountKind`）。証券なら「貯蓄・投資へ」に数える */
    toAccountKind: string | null
    /** 特別な支出（#835） */
    special?: boolean
    lines: readonly SummaryLine[]
}

export interface SummaryCategory {
    id: number
    name: string
    parentId: number | null
    order: number
    /** 会社関係（#835） */
    workRelated?: boolean
}

export interface SummaryOptions {
    /** 会社関係のカテゴリの品目を支出・収入から外す（#835） */
    excludeWork?: boolean
}

export interface CategoryTotal {
    /** 未分類は null */
    id: number | null
    name: string
    amount: number
    children: { id: number | null; name: string; amount: number }[]
}

export interface LedgerSummary {
    expense: number
    expensePending: number
    expensePendingCount: number
    /** 照合待ち（同じ支払いか人が決めるまで集計に入れない。#818） */
    matchPending: number
    matchPendingCount: number
    income: number
    /** 収入 − 支出 */
    balance: number
    toSavings: number
    adjustmentIncrease: number
    adjustmentDecrease: number
    /** 集計に含めないにした支出・収入の合計（参考） */
    excluded: number
    /** 支出のうち特別な支出（#835） */
    expenseSpecial: number
    expenseSpecialCount: number
    /** 収入のうち特別な印の付いたもの（引越し費用の精算など。#835） */
    incomeSpecial: number
    /** 「会社関係を除いて見る」で外した支出・収入（#835） */
    workExpense: number
    workIncome: number
    expenseByCategory: CategoryTotal[]
    incomeByCategory: CategoryTotal[]
}

export const UNCATEGORIZED_LABEL = "未分類"
/** 大分類に直接付けた品目を、中分類の並びで見せるときの名前 */
export const DIRECT_LABEL = "（中分類なし）"

function addToBreakdown(
    breakdown: Map<string, CategoryTotal>,
    categories: Map<number, SummaryCategory>,
    line: SummaryLine
): void {
    const category = line.categoryId != null ? categories.get(line.categoryId) : undefined
    const parent = category?.parentId != null ? categories.get(category.parentId) : undefined
    const top = parent ?? category
    const topKey = top ? String(top.id) : "none"
    let total = breakdown.get(topKey)
    if (!total) {
        total = { id: top?.id ?? null, name: top?.name ?? UNCATEGORIZED_LABEL, amount: 0, children: [] }
        breakdown.set(topKey, total)
    }
    total.amount += line.amount
    if (!top) return
    const childId = parent ? category!.id : null
    const childName = parent ? category!.name : DIRECT_LABEL
    let child = total.children.find((c) => c.id === childId)
    if (!child) {
        child = { id: childId, name: childName, amount: 0 }
        total.children.push(child)
    }
    child.amount += line.amount
}

function sortBreakdown(
    breakdown: Map<string, CategoryTotal>,
    categories: Map<number, SummaryCategory>
): CategoryTotal[] {
    const orderOf = (id: number | null) => (id == null ? Number.MAX_SAFE_INTEGER : categories.get(id)?.order ?? 0)
    const result = [...breakdown.values()]
    // 金額の大きい順。同額なら並び順
    result.sort((a, b) => b.amount - a.amount || orderOf(a.id) - orderOf(b.id))
    for (const total of result) {
        total.children.sort((a, b) => b.amount - a.amount || orderOf(a.id) - orderOf(b.id))
    }
    return result
}

/** 会社関係のカテゴリか。中分類は大分類の属性も見る */
export function isWorkCategory(categories: ReadonlyMap<number, SummaryCategory>, categoryId: number | null): boolean {
    if (categoryId == null) return false
    const category = categories.get(categoryId)
    if (!category) return false
    if (category.workRelated) return true
    return category.parentId != null && categories.get(category.parentId)?.workRelated === true
}

/** 月の推移・平均に使う支出（特別な支出を除く。#835） */
export function regularExpense(summary: LedgerSummary): number {
    return summary.expense - summary.expenseSpecial
}

export function summarizeLedger(
    entries: readonly SummaryEntry[],
    categoryList: readonly SummaryCategory[],
    options: SummaryOptions = {}
): LedgerSummary {
    const categories = new Map(categoryList.map((c) => [c.id, c]))
    const expenseBreakdown = new Map<string, CategoryTotal>()
    const incomeBreakdown = new Map<string, CategoryTotal>()
    const summary: LedgerSummary = {
        expense: 0,
        expensePending: 0,
        expensePendingCount: 0,
        matchPending: 0,
        matchPendingCount: 0,
        income: 0,
        balance: 0,
        toSavings: 0,
        adjustmentIncrease: 0,
        adjustmentDecrease: 0,
        excluded: 0,
        expenseSpecial: 0,
        expenseSpecialCount: 0,
        incomeSpecial: 0,
        workExpense: 0,
        workIncome: 0,
        expenseByCategory: [],
        incomeByCategory: [],
    }

    for (const entry of entries) {
        if (entry.status === "MATCH_PENDING") {
            summary.matchPending += entry.amount
            summary.matchPendingCount += 1
            continue
        }
        if (entry.kind === "TRANSFER") {
            if (entry.toAccountKind === "SECURITIES" && !entry.excludeFromTotals) summary.toSavings += entry.amount
            continue
        }
        if (entry.kind === "ADJUSTMENT") {
            // 入金先に口座がある調整は残高を増やしたもの、出金元にあるものは減らしたもの
            if (entry.toAccountId != null) summary.adjustmentIncrease += entry.amount
            else summary.adjustmentDecrease += entry.amount
            continue
        }
        if (entry.excludeFromTotals) {
            summary.excluded += entry.amount
            continue
        }
        let lines: readonly SummaryLine[] = entry.lines.length > 0 ? entry.lines : [{ amount: entry.amount, categoryId: null }]
        let amount = entry.amount
        if (options.excludeWork) {
            const kept = lines.filter((line) => !isWorkCategory(categories, line.categoryId))
            if (kept.length < lines.length) {
                const keptAmount = kept.reduce((sum, line) => sum + line.amount, 0)
                if (entry.kind === "EXPENSE") summary.workExpense += amount - keptAmount
                else summary.workIncome += amount - keptAmount
                lines = kept
                amount = keptAmount
                if (kept.length === 0) continue
            }
        }
        if (entry.kind === "EXPENSE") {
            summary.expense += amount
            if (entry.status === "PENDING_STATEMENT") {
                summary.expensePending += amount
                summary.expensePendingCount += 1
            }
            if (entry.special) {
                summary.expenseSpecial += amount
                summary.expenseSpecialCount += 1
            }
            for (const line of lines) addToBreakdown(expenseBreakdown, categories, line)
        } else {
            summary.income += amount
            if (entry.special) summary.incomeSpecial += amount
            for (const line of lines) addToBreakdown(incomeBreakdown, categories, line)
        }
    }

    summary.balance = summary.income - summary.expense
    summary.expenseByCategory = sortBreakdown(expenseBreakdown, categories)
    summary.incomeByCategory = sortBreakdown(incomeBreakdown, categories)
    return summary
}
