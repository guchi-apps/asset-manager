import type { ZaimHolding, ZaimSnapshot } from "./zaim-aide"

/**
 * 照合用キー。ZaimのDOMは名称の途中で要素が分かれ「楽天カー ド」のように
 * 空白・改行が混ざるため、空白を完全に除去した文字列で突き合わせる。
 */
export function toMatchKey(text: string): string {
    return text.replace(/\s+/g, "")
}

/** 証券銘柄を口座ごとに区別するための区切り文字（例: `SBI証券/eMAXIS Slim 全世界株式`） */
export const ACCOUNT_NAME_SEPARATOR = "/"

/** 同一口座内の同名銘柄を出現順で区別するための接尾辞（例: `SBI証券/オルカン#2`） */
export const OCCURRENCE_PREFIX = "#"

export interface ZaimMatchedEntry {
    /** 一致した valuationAlias の照合キー */
    aliasKey: string
    /** 画面表示・ログ用の名称 */
    name: string
    amount: number
    /**
     * 反映元の行のうち、もっとも古い最終更新（ISO8601）。連携していない行だけなら null。
     * 合算した1件でも古ければ合計そのものが古いため、いちばん古い値を代表にする。
     */
    lastUpdatedAt: string | null
}

/**
 * 2つの最終更新のうち古い方を返す。null（連携していない行）は判断材料にならないため無視する。
 * 手入力の口座しか含まないまとまりは null のままになり、鮮度による除外の対象にならない。
 */
export function oldestTimestamp(a: string | null, b: string | null): string | null {
    if (!a) return b
    if (!b) return a

    // 文字列の大小では比較しない。AIDEは「+09:00」付きで返すが、形が変わっても壊れないようにする。
    const left = Date.parse(a)
    const right = Date.parse(b)
    if (Number.isNaN(left)) return b
    if (Number.isNaN(right)) return a
    return left <= right ? a : b
}

export interface ZaimMatchResult {
    matched: ZaimMatchedEntry[]
    /** どの valuationAlias にも一致しなかった項目。alias にそのまま貼れる表記で返す。 */
    unmatched: string[]
}

/** 口座単位の名称（同名行がある場合はその合計を指す） */
export function accountHoldingName(holding: ZaimHolding): string {
    return `${holding.account}${ACCOUNT_NAME_SEPARATOR}${holding.name}`
}

/** 行単位の名称。同名行が複数ある場合だけ出現順の接尾辞を付ける。 */
export function holdingRowName(holding: ZaimHolding): string {
    const base = accountHoldingName(holding)
    return holding.occurrenceCount > 1 ? `${base}${OCCURRENCE_PREFIX}${holding.occurrence}` : base
}

/**
 * 取得結果を valuationAlias の照合キーへ突き合わせる。
 *
 * 優先順位は次のとおり。
 * 1. `口座名/銘柄名#N` — 同一口座内で同名の銘柄を、表示順のN行目として指定する
 *    （Zaimは旧NISA・新NISA等の口座区分を表示しないため、順番でしか区別できない）
 * 2. `口座名/銘柄名` — その口座の同名銘柄の合計。証券口座ごとに分けて管理する場合
 * 3. `銘柄名` — 口座をまたいだ同名銘柄の合計。1カテゴリにまとめる場合
 * 4. 残高一覧の名称 — 銀行・電子マネー等、および銘柄を反映していない証券口座の合計
 *
 * 同じ金額を二重に計上しないよう、上位で消費された行を含むまとまりは下位の候補から除外する。
 */
export function matchZaimSnapshot(
    snapshot: ZaimSnapshot,
    aliasKeys: Iterable<string>
): ZaimMatchResult {
    const keys = new Set(aliasKeys)
    const matched: ZaimMatchedEntry[] = []
    const unmatched: string[] = []
    const usedKeys = new Set<string>()
    // 銘柄を反映済みの証券口座。残高一覧側の口座合計と二重計上しないために記録する。
    const consumedAccounts = new Set<string>()
    const consumed = snapshot.holdings.map(() => false)

    const accountKeyOf = (holding: ZaimHolding) => toMatchKey(accountHoldingName(holding))
    const nameKeyOf = (holding: ZaimHolding) => toMatchKey(holding.name)

    // 1. 行単位（`口座名/銘柄名#N`）
    snapshot.holdings.forEach((holding, index) => {
        const name = `${accountHoldingName(holding)}${OCCURRENCE_PREFIX}${holding.occurrence}`
        const key = toMatchKey(name)
        if (!keys.has(key) || usedKeys.has(key)) return

        usedKeys.add(key)
        consumed[index] = true
        consumedAccounts.add(toMatchKey(holding.account))
        matched.push({
            aliasKey: key,
            name,
            amount: holding.amount,
            lastUpdatedAt: holding.lastUpdatedAt,
        })
    })

    // 行単位で一部でも消費された「口座+銘柄」は、合計側の候補から外す（二重計上の防止）
    const pinnedAccountKeys = new Set<string>()
    snapshot.holdings.forEach((holding, index) => {
        if (consumed[index]) pinnedAccountKeys.add(accountKeyOf(holding))
    })

    // 2. 口座単位（`口座名/銘柄名`）
    const consumedNameKeys = new Set<string>()
    const accountTotals = new Map<
        string,
        {
            name: string
            amount: number
            indexes: number[]
            account: string
            lastUpdatedAt: string | null
        }
    >()
    snapshot.holdings.forEach((holding, index) => {
        if (consumed[index]) return
        const key = accountKeyOf(holding)
        if (pinnedAccountKeys.has(key)) return

        const current = accountTotals.get(key)
        if (current) {
            current.amount += holding.amount
            current.indexes.push(index)
            current.lastUpdatedAt = oldestTimestamp(current.lastUpdatedAt, holding.lastUpdatedAt)
            return
        }
        accountTotals.set(key, {
            name: accountHoldingName(holding),
            amount: holding.amount,
            indexes: [index],
            account: holding.account,
            lastUpdatedAt: holding.lastUpdatedAt,
        })
    })

    for (const [key, total] of accountTotals) {
        if (!keys.has(key) || usedKeys.has(key)) continue

        usedKeys.add(key)
        for (const index of total.indexes) {
            consumed[index] = true
            consumedNameKeys.add(nameKeyOf(snapshot.holdings[index]))
        }
        consumedAccounts.add(toMatchKey(total.account))
        matched.push({
            aliasKey: key,
            name: total.name,
            amount: total.amount,
            lastUpdatedAt: total.lastUpdatedAt,
        })
    }

    // 上位で消費された銘柄は、銘柄名だけのaliasで合算しない（何を指すか曖昧になるため）
    snapshot.holdings.forEach((holding, index) => {
        if (consumed[index]) consumedNameKeys.add(nameKeyOf(holding))
    })

    // 3. 銘柄単位（`銘柄名`）
    const nameTotals = new Map<
        string,
        {
            name: string
            amount: number
            indexes: number[]
            accounts: string[]
            lastUpdatedAt: string | null
        }
    >()
    snapshot.holdings.forEach((holding, index) => {
        if (consumed[index]) return
        const key = nameKeyOf(holding)
        if (consumedNameKeys.has(key)) return

        const current = nameTotals.get(key)
        if (current) {
            current.amount += holding.amount
            current.indexes.push(index)
            current.accounts.push(holding.account)
            current.lastUpdatedAt = oldestTimestamp(current.lastUpdatedAt, holding.lastUpdatedAt)
            return
        }
        nameTotals.set(key, {
            name: holding.name,
            amount: holding.amount,
            indexes: [index],
            accounts: [holding.account],
            lastUpdatedAt: holding.lastUpdatedAt,
        })
    })

    for (const [key, total] of nameTotals) {
        if (!keys.has(key) || usedKeys.has(key)) continue

        usedKeys.add(key)
        for (const index of total.indexes) consumed[index] = true
        for (const account of total.accounts) consumedAccounts.add(toMatchKey(account))
        matched.push({
            aliasKey: key,
            name: total.name,
            amount: total.amount,
            lastUpdatedAt: total.lastUpdatedAt,
        })
    }

    // 4. どの alias にも一致しなかった銘柄は、そのまま alias に貼れる表記で報告する
    snapshot.holdings.forEach((holding, index) => {
        if (!consumed[index]) unmatched.push(holdingRowName(holding))
    })

    // 5. 残高一覧
    for (const balance of snapshot.balances) {
        const key = toMatchKey(balance.name)
        // 銘柄を反映済みの証券口座は、合計を足すと同じ資産を二重に数えることになる。
        if (consumedAccounts.has(key)) continue

        if (keys.has(key) && !usedKeys.has(key)) {
            usedKeys.add(key)
            matched.push({
                aliasKey: key,
                name: balance.name,
                amount: balance.amount,
                lastUpdatedAt: balance.lastUpdatedAt,
            })
            continue
        }
        unmatched.push(balance.name)
    }

    return { matched, unmatched }
}

export interface ZaimAliasCategory {
    id: number
    name: string
    valuationAlias: string | null
}

/** 保存前の対応付け設定（テスト読み込みで画面から受け取る1件） */
export interface ZaimAliasSetting {
    id: number
    valuationAlias: string | null
    isValuationTarget: boolean
}

/**
 * テスト読み込みの対象を組み立てる。
 *
 * **`settings` の並び順をそのまま保つ。** 同名の行が複数あるときの割り当ては
 * `resolveZaimEntries` へ渡した配列の順で決まるため、保存済みの `valuationOrder` や
 * DBの返す順で組み直すと、**画面で入れ替えた順番がテスト読み込みに反映されない**（#340）。
 *
 * 名称は必ずDB側（`categories`）から取り、クライアントの値は使わない。
 * DBに無いID・対象外の項目は落とす。
 */
export function buildZaimAliasTargets(
    settings: ZaimAliasSetting[],
    categories: ZaimAliasCategory[]
): ZaimAliasCategory[] {
    const categoryById = new Map(categories.map((category) => [category.id, category]))

    return settings.flatMap((setting) => {
        const category = categoryById.get(setting.id)
        if (!category || !setting.isValuationTarget) return []
        return [
            {
                id: category.id,
                name: category.name,
                valuationAlias: setting.valuationAlias ?? category.valuationAlias,
            },
        ]
    })
}

export interface ZaimResolvedEntry {
    categoryId: number
    categoryName: string
    /** 反映元となったZaim側の名称（複数一致した場合は合算元をすべて含む） */
    sources: string[]
    amount: number
    /**
     * 反映元の行のうち、もっとも古い最終更新（ISO8601）。連携していない行だけなら null。
     * 定期実行は、これが記録日と違う日であれば「Zaim側が当日の残高を持っていない」とみなす。
     */
    lastUpdatedAt: string | null
}

/** valuationAlias は「,」「、」「|」区切りで複数の名称を設定できる。 */
export function splitAliases(valuationAlias: string | null): string[] {
    if (!valuationAlias) return []
    return valuationAlias
        .split(/[,、|]/)
        .map((alias) => toMatchKey(alias))
        .filter(Boolean)
}

/**
 * 取得結果とカテゴリの valuationAlias から、カテゴリごとの反映値を求める。
 * DBに依存しないため、保存前の編集中の alias でも試せる。
 */
export function resolveZaimEntries(
    categories: ZaimAliasCategory[],
    snapshot: ZaimSnapshot
): { entries: ZaimResolvedEntry[]; unmatched: string[] } {
    // 同じZaim表示名を複数のカテゴリに設定した場合、証券詳細ページの同名行を
    // 表示順に1件ずつ割り当てる。証券会社由来の銘柄名は利用者が変えられないため、
    // 旧NISA・新NISA等の区別を `#N` の手入力なしで行えるようにする。
    const categoriesByAliasKey = new Map<string, ZaimAliasCategory[]>()
    for (const category of categories) {
        for (const aliasKey of splitAliases(category.valuationAlias)) {
            const list = categoriesByAliasKey.get(aliasKey)
            if (list) list.push(category)
            else categoriesByAliasKey.set(aliasKey, [category])
        }
    }

    const categoryByAliasKey = new Map<string, ZaimAliasCategory>()
    for (const [aliasKey, sharing] of categoriesByAliasKey) {
        if (sharing.length === 1) {
            categoryByAliasKey.set(aliasKey, sharing[0])
            continue
        }

        // 口座名付きで一致する行を優先し、無ければ銘柄名だけで一致する行を使う。
        const rows =
            snapshot.holdings.filter(
                (holding) => toMatchKey(accountHoldingName(holding)) === aliasKey
            ) ?? []
        const candidates =
            rows.length > 0
                ? rows
                : snapshot.holdings.filter((holding) => toMatchKey(holding.name) === aliasKey)

        if (candidates.length < 2) {
            // 分割できる行が無い場合は従来どおり先の1件だけへ割り当てる。
            categoryByAliasKey.set(aliasKey, sharing[0])
            continue
        }

        sharing.forEach((category, index) => {
            const row = candidates[index]
            if (!row) return
            const rowKey = toMatchKey(
                `${accountHoldingName(row)}${OCCURRENCE_PREFIX}${row.occurrence}`
            )
            if (!categoryByAliasKey.has(rowKey)) categoryByAliasKey.set(rowKey, category)
        })
    }

    const { matched, unmatched } = matchZaimSnapshot(snapshot, categoryByAliasKey.keys())

    // 1つのカテゴリに複数のaliasを設定して複数一致した場合は、
    // どれか1つだけ反映して残りを捨てないよう合算する。
    const entryByCategoryId = new Map<number, ZaimResolvedEntry>()
    for (const item of matched) {
        const category = categoryByAliasKey.get(item.aliasKey)
        if (!category) continue

        const current = entryByCategoryId.get(category.id)
        if (current) {
            current.amount += item.amount
            current.sources.push(item.name)
            current.lastUpdatedAt = oldestTimestamp(current.lastUpdatedAt, item.lastUpdatedAt)
            continue
        }
        entryByCategoryId.set(category.id, {
            categoryId: category.id,
            categoryName: category.name,
            sources: [item.name],
            amount: item.amount,
            lastUpdatedAt: item.lastUpdatedAt,
        })
    }

    return { entries: [...entryByCategoryId.values()], unmatched }
}
