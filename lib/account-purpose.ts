/**
 * 口座の用途と、資産カテゴリの「有効な用途」の決め方（Issue #965）。DBに触らない純粋な関数だけを置く。
 *
 * 有効な用途の優先順位:
 *  1. カテゴリの `excludeFromInvestmentView` が立っていれば、口座の用途が投資でも生活防衛費として扱う
 *  2. 紐づく口座（`LedgerAccount.assetCategoryId`）の用途
 *  3. どちらも無ければ従来のフラグ（`isLiability`→負債、`isCash`→貯蓄、それ以外→投資）
 */

export const ACCOUNT_PURPOSES = ["INVESTMENT", "SAVINGS", "LIVING", "EMERGENCY", "LIABILITY"] as const
export type AccountPurpose = (typeof ACCOUNT_PURPOSES)[number]

export const ACCOUNT_PURPOSE_LABELS: Record<AccountPurpose, string> = {
    INVESTMENT: "投資",
    SAVINGS: "貯蓄",
    LIVING: "生活資金",
    EMERGENCY: "生活防衛費",
    LIABILITY: "負債",
}

export function isAccountPurpose(value: unknown): value is AccountPurpose {
    return typeof value === "string" && (ACCOUNT_PURPOSES as readonly string[]).includes(value)
}

/** 口座の種類から用途の初期値を提案する（新規作成時のみ使う） */
export function suggestPurposeForKind(kind: string): AccountPurpose {
    switch (kind) {
        case "CARD":
            return "LIABILITY"
        case "SECURITIES":
            return "INVESTMENT"
        default:
            return "LIVING"
    }
}

export interface PurposeCategory {
    id: number
    parentId?: number | null
    isCash?: boolean
    isLiability?: boolean
    excludeFromInvestmentView?: boolean
}

export interface PurposeAccount {
    assetCategoryId: number | null
    purpose: AccountPurpose | null
    hidden: boolean
    order: number
    id: number
}

/** 従来のフラグだけから用途を決める（口座の用途が無いとき） */
export function purposeFromFlags(c: Pick<PurposeCategory, "isCash" | "isLiability" | "excludeFromInvestmentView">): AccountPurpose {
    if (c.isLiability) return "LIABILITY"
    if (c.excludeFromInvestmentView) return "EMERGENCY"
    if (c.isCash) return "SAVINGS"
    return "INVESTMENT"
}

/**
 * カテゴリごとの有効な用途を返す（キーはカテゴリID）。
 * - `hidden` の口座は使わない。複数の口座が同じカテゴリに紐づくときは order → id の先頭
 * - 子カテゴリに紐づく口座の用途は親へ伝播させる（集計はトップレベルだけを見るため）。
 *   親自身に紐づく口座があればそちらを優先する
 */
export function resolveCategoryPurposes(
    categories: PurposeCategory[],
    accounts: PurposeAccount[]
): Map<number, AccountPurpose> {
    const byId = new Map(categories.map((c) => [c.id, c]))
    const sorted = [...accounts]
        .filter((a) => !a.hidden && a.purpose && a.assetCategoryId != null)
        .sort((a, b) => a.order - b.order || a.id - b.id)

    const direct = new Map<number, AccountPurpose>()
    const inherited = new Map<number, AccountPurpose>()
    for (const a of sorted) {
        const cat = byId.get(a.assetCategoryId as number)
        if (!cat || !a.purpose) continue
        if (!direct.has(cat.id) && cat.parentId == null) direct.set(cat.id, a.purpose)
        if (cat.parentId != null) {
            // 子から親へ。親が見つからないときは何もしない
            let root: PurposeCategory | undefined = cat
            const seen = new Set<number>()
            while (root && root.parentId != null && !seen.has(root.id)) {
                seen.add(root.id)
                root = byId.get(root.parentId)
            }
            if (root && !inherited.has(root.id)) inherited.set(root.id, a.purpose)
        }
    }

    const result = new Map<number, AccountPurpose>()
    for (const c of categories) {
        // 子は親の用途に従う（親が決まってから引くため、ここではトップレベルだけ決める）
        if (c.parentId != null) continue
        if (c.excludeFromInvestmentView && !c.isLiability) {
            result.set(c.id, "EMERGENCY")
            continue
        }
        const fromAccount = direct.get(c.id) ?? inherited.get(c.id)
        result.set(c.id, fromAccount ?? purposeFromFlags(c))
    }
    for (const c of categories) {
        if (c.parentId == null) continue
        let root: PurposeCategory | undefined = c
        const seen = new Set<number>()
        while (root && root.parentId != null && !seen.has(root.id)) {
            seen.add(root.id)
            root = byId.get(root.parentId)
        }
        const p = root ? result.get(root.id) : undefined
        if (p) result.set(c.id, p)
    }
    return result
}
