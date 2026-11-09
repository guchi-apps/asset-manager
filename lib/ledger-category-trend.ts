/**
 * カテゴリ別の月ごとの推移（Issue #1270）。DBに触らない純関数。
 * 期間ごとの集計（`summarizeLedger` の結果）から、大分類・中分類ごとの金額の並びを作る。
 */
import { sortByCategoryOrder, type CategoryTotal } from "@/lib/ledger-summary"

export interface TrendSeriesPoint {
    label: string
    expenseByCategory: CategoryTotal[]
    incomeByCategory: CategoryTotal[]
}

export interface CategoryTrendRow {
    /** 大分類は "<id>"、中分類は "<親id>/<id>"。未分類・中分類なしは "none"・"<親id>/direct" */
    key: string
    name: string
    /** 期間（古い順）ごとの金額 */
    values: number[]
    /** 期間の数で割った平均（金額の無い期間も0として数える） */
    average: number
    children: CategoryTrendRow[]
}

function average(values: number[]): number {
    return values.length === 0 ? 0 : Math.round(values.reduce((a, b) => a + b, 0) / values.length)
}

/** 大分類ごとの行を、カテゴリ画面の並び順で返す。1期間にも出てこないカテゴリは含めない */
export function buildCategoryTrend(series: readonly TrendSeriesPoint[], kind: "expense" | "income"): CategoryTrendRow[] {
    const pick = (p: TrendSeriesPoint) => (kind === "expense" ? p.expenseByCategory : p.incomeByCategory)
    const tops = new Map<string, CategoryTotal>()
    for (const p of series) {
        for (const t of pick(p)) {
            const key = t.id == null ? "none" : String(t.id)
            const known = tops.get(key)
            if (!known) tops.set(key, { ...t, children: [...t.children] })
            else for (const c of t.children) if (!known.children.some((k) => k.id === c.id)) known.children.push(c)
        }
    }
    return sortByCategoryOrder([...tops.values()]).map((top) => {
        const topKey = top.id == null ? "none" : String(top.id)
        const totals = series.map((p) => pick(p).find((t) => (t.id == null ? "none" : String(t.id)) === topKey))
        const values = totals.map((t) => t?.amount ?? 0)
        const children = top.children.map((child) => {
            const cv = totals.map((t) => t?.children.find((c) => c.id === child.id)?.amount ?? 0)
            return {
                key: `${topKey}/${child.id ?? "direct"}`,
                name: child.name,
                values: cv,
                average: average(cv),
                children: [],
            }
        })
        return { key: topKey, name: top.name, values, average: average(values), children: children.length > 1 || (children.length === 1 && !children[0].key.endsWith("/direct")) ? children : [] }
    })
}
