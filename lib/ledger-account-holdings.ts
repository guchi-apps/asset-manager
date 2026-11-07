/**
 * 家計簿の口座と、その中身にあたる資産カテゴリの結び付け（Issue #970）。DBに触らない純粋な関数だけを置く。
 *
 * 結び付けはカテゴリ側に持つ（`Category.ledgerAccountId`）。1つの口座（証券口座）に複数のカテゴリ（銘柄）がぶら下がる。
 * - カテゴリが属する口座は、自分か最も近い祖先の結び付け。親カテゴリを結び付ければ子もその口座の中身になり、
 *   子に別の結び付けがあれば子が優先する
 * - 評価額は葉のカテゴリだけで数える。子を持つカテゴリの評価額は子の合計で、自分の記録は使わない（`lib/map-categories.ts`）
 */

export interface LinkCategory {
    id: number
    name: string
    parentId: number | null
    ledgerAccountId: number | null
}

/** カテゴリIDごとの、属する口座のID（自分か最も近い祖先の結び付け）。どこにも属さないカテゴリは含めない */
export function resolveCategoryAccounts(categories: readonly LinkCategory[]): Map<number, number> {
    const byId = new Map(categories.map((c) => [c.id, c]))
    const result = new Map<number, number>()
    for (const c of categories) {
        let cur: LinkCategory | undefined = c
        const seen = new Set<number>()
        while (cur && !seen.has(cur.id)) {
            if (cur.ledgerAccountId != null) {
                result.set(c.id, cur.ledgerAccountId)
                break
            }
            seen.add(cur.id)
            cur = cur.parentId != null ? byId.get(cur.parentId) : undefined
        }
    }
    return result
}

/** 子を持たないカテゴリのID */
export function leafCategoryIds(categories: readonly Pick<LinkCategory, "id" | "parentId">[]): Set<number> {
    const parents = new Set(categories.filter((c) => c.parentId != null).map((c) => c.parentId as number))
    return new Set(categories.filter((c) => !parents.has(c.id)).map((c) => c.id))
}

/**
 * 選んだカテゴリ（とその子孫）のうち、評価額を数える葉のカテゴリ。
 * 口座を保存する前（画面で選んでいる途中）の初期残高の候補に使う。
 */
export function expandToLeaves(categories: readonly Pick<LinkCategory, "id" | "parentId">[], selectedIds: Iterable<number>): number[] {
    const selected = new Set(selectedIds)
    const byId = new Map(categories.map((c) => [c.id, c]))
    const leaves = leafCategoryIds(categories)
    const result: number[] = []
    for (const c of categories) {
        if (!leaves.has(c.id)) continue
        let cur: Pick<LinkCategory, "id" | "parentId"> | undefined = c
        const seen = new Set<number>()
        while (cur && !seen.has(cur.id)) {
            if (selected.has(cur.id)) {
                result.push(c.id)
                break
            }
            seen.add(cur.id)
            cur = cur.parentId != null ? byId.get(cur.parentId) : undefined
        }
    }
    return result
}

export interface HoldingItem {
    categoryId: number
    name: string
    /** 最新の評価額（円）。記録が無ければ 0 */
    value: number
    /** 最新の評価額を記録した日（JSTの `YYYY-MM-DD`）。記録が無ければ null */
    recordedOn: string | null
}

export interface AccountHoldings {
    /** 葉のカテゴリの最新の評価額の合計（円） */
    total: number
    items: HoldingItem[]
}

/**
 * 口座ごとの中身（葉のカテゴリ）と評価額の合計。中身が1つも無い口座は含めない。
 * `latest` はカテゴリIDごとの最新の評価額。並びは `categories` の順。
 */
export function collectAccountHoldings(
    categories: readonly LinkCategory[],
    latest: ReadonlyMap<number, { value: number; recordedOn: string }>
): Map<number, AccountHoldings> {
    const accountOf = resolveCategoryAccounts(categories)
    const leaves = leafCategoryIds(categories)
    const result = new Map<number, AccountHoldings>()
    for (const c of categories) {
        const accountId = accountOf.get(c.id)
        if (accountId == null || !leaves.has(c.id)) continue
        const record = latest.get(c.id)
        const value = record ? Math.round(record.value) : 0
        const holdings = result.get(accountId) ?? { total: 0, items: [] }
        holdings.total += value
        holdings.items.push({ categoryId: c.id, name: c.name, value, recordedOn: record?.recordedOn ?? null })
        result.set(accountId, holdings)
    }
    return result
}

/**
 * 「Zaimの残高に合わせる」の対象から外す口座か。
 * 証券・投資の口座の評価額は含み損益で動くため、合わせると値動きが残高調整や初期残高として家計簿へ入ってしまう。
 * 中身の評価額は資産（銘柄ごとのカテゴリ）で持つ。
 */
export function isExcludedFromReconcile(account: { kind: string; purpose: string | null }): boolean {
    return account.kind === "SECURITIES" || account.purpose === "INVESTMENT"
}
