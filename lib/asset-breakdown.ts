/**
 * 投資・現金・負債という粒度で「いま全部でいくらか」を出す（Issue #344）。
 *
 * カテゴリの評価額は `mapCategoriesFromRows` が親へ集約済みなので、**トップレベルだけを足す**。
 * 種別は親カテゴリの `isCash` / `isLiability` で決まる（子が別の種別でも親に寄せる）。
 *
 * **負債の評価額はマイナスの金額として持つ。** Zaimの残高一覧はカード・借入をマイナスで返し
 * （`lib/zaim-aide.ts` の `ZaimBalance.amount`）、自動取得はその値をそのまま `Asset` へ保存する。
 * 表示のたびに符号を反転させずに済むよう、こちら側でも符号を変えない。そのため
 * `totalLiabilities` だけは**正の値**（返済すべき額）で返す。
 */

export type AssetKind = "investment" | "cash" | "liability"

export interface BreakdownCategory {
    parentId?: number | null
    currentValue: number
    costBasis: number
    realizedGain?: number
    isCash?: boolean
    isLiability?: boolean
}

export interface AssetBreakdown {
    /** 負債を含まない資産の合計 */
    totalAssets: number
    /** 負債の合計。**正の値**（マイナスの評価額の符号を反転したもの） */
    totalLiabilities: number
    /** 総資産 − 負債 */
    netWorth: number
    /** 値動きのある資産（現金・負債のどちらでもないもの） */
    investment: number
    /** 現金・預金 */
    cash: number
    /** 取得原価。負債は含めず、現金は評価額をそのまま原価として扱う */
    totalCost: number
    /** 評価損益。実質的に投資のぶんだけが乗る */
    totalProfit: number
    totalProfitRate: number
    totalRealizedGain: number
}

export function categoryKind(category: Pick<BreakdownCategory, "isCash" | "isLiability">): AssetKind {
    if (category.isLiability) return "liability"
    if (category.isCash) return "cash"
    return "investment"
}

const toNumber = (value: unknown): number => {
    const num = Number(value)
    return Number.isFinite(num) ? num : 0
}

export function computeAssetBreakdown(categories: BreakdownCategory[]): AssetBreakdown {
    let investment = 0
    let cash = 0
    let liabilityValue = 0
    let totalCost = 0
    let totalRealizedGain = 0

    for (const category of categories) {
        if (category.parentId != null) continue

        const value = toNumber(category.currentValue)

        switch (categoryKind(category)) {
            case "liability":
                liabilityValue += value
                continue
            case "cash":
                cash += value
                // 現金は損益を常に0として扱う（原価＝評価額）。`sumCostBasis` と同じ扱い。
                totalCost += value
                break
            default:
                investment += value
                totalCost += toNumber(category.costBasis)
        }

        totalRealizedGain += toNumber(category.realizedGain)
    }

    const totalAssets = investment + cash
    // `-0` を作らない。Intl.NumberFormat は -0 を「-0」と書くため、負債0件でも符号が出てしまう。
    const totalLiabilities = liabilityValue === 0 ? 0 : -liabilityValue
    const totalProfit = totalAssets - totalCost

    return {
        totalAssets,
        totalLiabilities,
        netWorth: totalAssets - totalLiabilities,
        investment,
        cash,
        totalCost,
        totalProfit,
        totalProfitRate: totalCost > 0 ? (totalProfit / totalCost) * 100 : 0,
        totalRealizedGain,
    }
}

/**
 * 帯グラフ用の割合（%）。**総資産を100%とし、負債も同じ物差しで測る**ので、
 * 3つを足しても100にはならない（負債は総資産に対する大きさを表す）。
 */
export function breakdownRatios(breakdown: AssetBreakdown): {
    investment: number
    cash: number
    liability: number
} {
    const base = breakdown.totalAssets
    if (base <= 0) return { investment: 0, cash: 0, liability: 0 }
    return {
        investment: (breakdown.investment / base) * 100,
        cash: (breakdown.cash / base) * 100,
        liability: (breakdown.totalLiabilities / base) * 100,
    }
}
