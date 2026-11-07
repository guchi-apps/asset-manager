/**
 * 口座の用途と、資産カテゴリの「有効な用途」の決め方（Issue #965）。DBに触らない純粋な関数だけを置く。
 *
 * 有効な用途の優先順位:
 *  1. カテゴリの `excludeFromInvestmentView` が立っていれば、口座の用途が投資でも生活防衛費として扱う
 *  2. カテゴリを結び付けた口座（`Category.ledgerAccountId`。Issue #970）の用途
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
    /** 結び付けた家計簿の口座（`Category.ledgerAccountId`。#970） */
    ledgerAccountId?: number | null
}

export interface PurposeAccount {
    id: number
    purpose: AccountPurpose | null
    hidden: boolean
    order: number
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
 * - `hidden` の口座・用途が未設定の口座は使わない
 * - 子カテゴリに結び付けた口座の用途は親へ伝播させる（集計はトップレベルだけを見るため）。
 *   親自身に結び付けた口座があればそちらを優先し、子どうしで分かれるときは口座の order → id の先頭
 */
export function resolveCategoryPurposes(
    categories: PurposeCategory[],
    accounts: PurposeAccount[]
): Map<number, AccountPurpose> {
    const byId = new Map(categories.map((c) => [c.id, c]))
    const accountById = new Map(accounts.filter((a) => !a.hidden && a.purpose).map((a) => [a.id, a]))

    const direct = new Map<number, AccountPurpose>()
    const inherited = new Map<number, PurposeAccount>()
    for (const cat of categories) {
        const account = cat.ledgerAccountId != null ? accountById.get(cat.ledgerAccountId) : undefined
        if (!account?.purpose) continue
        if (cat.parentId == null) {
            direct.set(cat.id, account.purpose)
            continue
        }
        // 子から親へ。親が見つからないときは何もしない
        let root: PurposeCategory | undefined = cat
        const seen = new Set<number>()
        while (root && root.parentId != null && !seen.has(root.id)) {
            seen.add(root.id)
            root = byId.get(root.parentId)
        }
        if (!root) continue
        const prev = inherited.get(root.id)
        if (!prev || account.order < prev.order || (account.order === prev.order && account.id < prev.id)) inherited.set(root.id, account)
    }

    const result = new Map<number, AccountPurpose>()
    for (const c of categories) {
        // 子は親の用途に従う（親が決まってから引くため、ここではトップレベルだけ決める）
        if (c.parentId != null) continue
        if (c.excludeFromInvestmentView && !c.isLiability) {
            result.set(c.id, "EMERGENCY")
            continue
        }
        const fromAccount = direct.get(c.id) ?? inherited.get(c.id)?.purpose
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

export interface UnlinkedAccountInput {
    purpose: string | null
    hidden: boolean
    /** 家計簿で計算した残高（カードは使ったぶんだけマイナス） */
    balance: number
    /** 中身として結び付けた資産カテゴリ（`Category.ledgerAccountId`。#970） */
    assetCategoryIds: readonly number[]
}

/**
 * 中身の資産カテゴリが無い口座を、ホームの内訳（`computeAssetBreakdown`）の項目に変換する（#1015）。
 * カードのように結び付けるカテゴリが無い口座は、家計簿の残高をそのまま口座の用途の帯へ足す。
 * - 中身のある口座は従来どおりカテゴリの評価額で数えるので対象外（二重に数えない）
 * - `hidden` の口座・用途が未設定の口座は数えない（#972 以前の表示を変えない）
 * - 取得原価は残高と同じにする（家計簿の残高に含み損益は無い）
 * - 用途が投資の口座は数えない（Issue #1030）。投資として数えるのは投資資産と連携した（中身を結び付けた）口座だけで、
 *   その評価額は資産カテゴリの側で数える。家計簿の残高は振替の積み上げで、評価額ではないため
 */
export function unlinkedAccountBreakdownItems(accounts: readonly UnlinkedAccountInput[]): {
    parentId: null
    currentValue: number
    costBasis: number
    purpose: AccountPurpose
}[] {
    return accounts.flatMap((a) => {
        if (a.hidden || !isAccountPurpose(a.purpose) || a.purpose === "INVESTMENT" || a.assetCategoryIds.length > 0) return []
        const value = Number.isFinite(a.balance) ? a.balance : 0
        return [{ parentId: null, currentValue: value, costBasis: value, purpose: a.purpose }]
    })
}

/**
 * 口座の用途「投資」を保存してよいか（Issue #1030）。投資として数えるのは投資資産と連携した口座だけなので、
 * 中身の資産カテゴリを1つも結び付けていない口座には選ばせない。
 * 既に用途が投資の口座（この制限より前に作った口座）は、用途を変えるまでそのまま保存できる。
 * 保存できなければ理由を返す。
 */
export function investmentPurposeError(
    purpose: string | null,
    linkedCategoryCount: number,
    previousPurpose?: string | null
): string | null {
    if (purpose !== "INVESTMENT" || linkedCategoryCount > 0 || previousPurpose === "INVESTMENT") return null
    return "用途「投資」は、中身の資産カテゴリ（投資資産）を選ぶと選べます"
}
