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

import { purposeFromFlags, type AccountPurpose } from "@/lib/account-purpose"

export type AssetKind = "investment" | "cash" | "liability"

export interface BreakdownCategory {
    /** 口座別の表示名（ホームの内訳の展開で使う。集計には影響しない） */
    name?: string
    parentId?: number | null
    currentValue: number
    costBasis: number
    realizedGain?: number
    isCash?: boolean
    isLiability?: boolean
    excludeFromInvestmentView?: boolean
    /** 有効な用途（#965）。あれば isCash/isLiability より優先する */
    purpose?: AccountPurpose
}

export interface AssetBreakdown {
    /** 負債を含まない資産の合計 */
    totalAssets: number
    /** 負債の合計（クレジットカードを含む）。**正の値**（マイナスの評価額の符号を反転したもの） */
    totalLiabilities: number
    /** うちクレジットカード（用途「クレジットカード」。#1117）。**正の値** */
    creditCard: number
    /** うちクレジットカード以外の負債。**正の値** */
    debt: number
    /** 総資産 − 負債 */
    netWorth: number
    /** 値動きのある資産（現金・負債のどちらでもないもの） */
    investment: number
    /** 現金・預金（貯蓄・生活資金・生活防衛費の合計） */
    cash: number
    /** 用途別の内訳（#965） */
    savings: number
    living: number
    emergency: number
    /** 取得原価。負債は含めず、現金は評価額をそのまま原価として扱う */
    totalCost: number
    /** 評価損益。実質的に投資のぶんだけが乗る */
    totalProfit: number
    totalProfitRate: number
    totalRealizedGain: number
}

/** カテゴリの用途。`purpose` があればそれを、無ければ従来のフラグから決める */
export function categoryPurpose(category: BreakdownCategory): AccountPurpose {
    return category.purpose ?? purposeFromFlags(category)
}

export function categoryKind(category: Pick<BreakdownCategory, "isCash" | "isLiability"> & Partial<BreakdownCategory>): AssetKind {
    const purpose = category.purpose
    if (purpose) {
        if (purpose === "LIABILITY" || purpose === "CREDIT_CARD") return "liability"
        return purpose === "INVESTMENT" ? "investment" : "cash"
    }
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
    let savings = 0
    let living = 0
    let emergency = 0
    let liabilityValue = 0
    let creditCardValue = 0
    let totalCost = 0
    let totalRealizedGain = 0

    for (const category of categories) {
        if (category.parentId != null) continue

        const value = toNumber(category.currentValue)

        switch (categoryKind(category)) {
            case "liability":
                liabilityValue += value
                if (categoryPurpose(category) === "CREDIT_CARD") creditCardValue += value
                continue
            case "cash":
                cash += value
                // 用途が無い従来の現金・預金は貯蓄として数える（生活防衛費の指定だけは別枠）
                switch (categoryPurpose(category)) {
                    case "LIVING":
                        living += value
                        break
                    case "EMERGENCY":
                        emergency += value
                        break
                    default:
                        savings += value
                }
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
    const creditCard = creditCardValue === 0 ? 0 : -creditCardValue
    const totalProfit = totalAssets - totalCost

    return {
        totalAssets,
        totalLiabilities,
        creditCard,
        debt: totalLiabilities - creditCard,
        netWorth: totalAssets - totalLiabilities,
        investment,
        cash,
        savings,
        living,
        emergency,
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
    savings: number
    living: number
    emergency: number
    liability: number
    creditCard: number
} {
    const base = breakdown.totalAssets
    if (base <= 0) return { investment: 0, cash: 0, savings: 0, living: 0, emergency: 0, liability: 0, creditCard: 0 }
    return {
        investment: (breakdown.investment / base) * 100,
        cash: (breakdown.cash / base) * 100,
        savings: (breakdown.savings / base) * 100,
        living: (breakdown.living / base) * 100,
        emergency: (breakdown.emergency / base) * 100,
        liability: (breakdown.debt / base) * 100,
        creditCard: (breakdown.creditCard / base) * 100,
    }
}

/** ホームの内訳の並び（#1049）。帯・タイル・口座別の展開で共有する */
export const BREAKDOWN_KEYS = ["investment", "emergency", "savings", "living", "liability", "creditCard"] as const
export type BreakdownKey = (typeof BREAKDOWN_KEYS)[number]

export interface BreakdownAccount {
    name: string
    /** 負債はマイナスの評価額のまま持つ */
    value: number
}

/**
 * 種別ごとの口座別の金額（#1049）。`computeAssetBreakdown` と同じくトップレベルだけを数え、
 * 種別の決め方も同じ（用途が無ければ従来のフラグ）。金額が0の口座は除き、大きい順に並べる。
 */
export function breakdownAccounts(categories: BreakdownCategory[]): Record<BreakdownKey, BreakdownAccount[]> {
    const result: Record<BreakdownKey, BreakdownAccount[]> = {
        investment: [],
        savings: [],
        emergency: [],
        living: [],
        liability: [],
        creditCard: [],
    }
    for (const category of categories) {
        if (category.parentId != null) continue
        const value = toNumber(category.currentValue)
        if (value === 0) continue
        const kind = categoryKind(category)
        // 現金のうち、用途が無い従来の現金・預金は貯蓄として数える（computeAssetBreakdown と同じ）
        const key: BreakdownKey =
            kind === "liability" ? (categoryPurpose(category) === "CREDIT_CARD" ? "creditCard" : "liability")
            : kind === "investment" ? "investment"
            : categoryPurpose(category) === "LIVING" ? "living"
            : categoryPurpose(category) === "EMERGENCY" ? "emergency"
            : "savings"
        result[key].push({ name: category.name || "名称未設定", value })
    }
    for (const key of BREAKDOWN_KEYS) {
        // 負債はマイナスなので絶対値の大きい順
        result[key].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    }
    return result
}
