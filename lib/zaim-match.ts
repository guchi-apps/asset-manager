import { toMatchKey, type ZaimHolding, type ZaimSnapshot } from "./zaim-scraper"

/** 証券銘柄を口座ごとに区別するための区切り文字（例: `SBI証券/eMAXIS Slim 全世界株式`） */
export const ACCOUNT_NAME_SEPARATOR = "/"

export interface ZaimMatchedEntry {
    /** 一致した valuationAlias の照合キー */
    aliasKey: string
    /** 画面表示・ログ用の名称 */
    name: string
    amount: number
}

export interface ZaimMatchResult {
    matched: ZaimMatchedEntry[]
    /** どの valuationAlias にも一致しなかった項目。alias にそのまま貼れる表記で返す。 */
    unmatched: string[]
}

export function qualifiedHoldingName(holding: ZaimHolding): string {
    return `${holding.account}${ACCOUNT_NAME_SEPARATOR}${holding.name}`
}

/**
 * 取得結果を valuationAlias の照合キーへ突き合わせる。
 *
 * 優先順位は次のとおり。
 * 1. `口座名/銘柄名` — 同じ銘柄を証券口座ごとに別カテゴリで管理する場合
 * 2. `銘柄名` — 口座をまたいで1カテゴリにまとめる場合（複数口座分を合算する）
 * 3. 残高一覧の名称 — 銀行・電子マネー等、および銘柄を反映していない証券口座の合計
 *
 * 同じ金額を二重に計上しないよう、上位で消費された項目は下位の候補から除外する。
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

    // 1. 口座名付きの銘柄
    const accountQualifiedNames = new Set<string>()
    snapshot.holdings.forEach((holding, index) => {
        const name = qualifiedHoldingName(holding)
        const key = toMatchKey(name)
        if (!keys.has(key) || usedKeys.has(key)) return

        usedKeys.add(key)
        consumed[index] = true
        accountQualifiedNames.add(toMatchKey(holding.name))
        consumedAccounts.add(toMatchKey(holding.account))
        matched.push({ aliasKey: key, name, amount: holding.amount })
    })

    // 2. 銘柄名のみ（口座をまたいで合算）
    const totals = new Map<
        string,
        { name: string; amount: number; indexes: number[]; accounts: string[] }
    >()
    snapshot.holdings.forEach((holding, index) => {
        if (consumed[index]) return

        const key = toMatchKey(holding.name)
        // 同じ銘柄の一部が口座名付きで一致している場合、残りを合算すると
        // 「銘柄名だけ」の alias が何を指すのか曖昧になるため合算対象から外す。
        if (accountQualifiedNames.has(key)) return

        const current = totals.get(key)
        if (current) {
            current.amount += holding.amount
            current.indexes.push(index)
            current.accounts.push(holding.account)
            return
        }
        totals.set(key, {
            name: holding.name,
            amount: holding.amount,
            indexes: [index],
            accounts: [holding.account],
        })
    })

    for (const [key, total] of totals) {
        if (!keys.has(key) || usedKeys.has(key)) continue

        usedKeys.add(key)
        for (const index of total.indexes) consumed[index] = true
        for (const account of total.accounts) consumedAccounts.add(toMatchKey(account))
        matched.push({ aliasKey: key, name: total.name, amount: total.amount })
    }

    // 3. どの alias にも一致しなかった銘柄は、口座名付きの表記で報告する
    snapshot.holdings.forEach((holding, index) => {
        if (!consumed[index]) unmatched.push(qualifiedHoldingName(holding))
    })

    // 4. 残高一覧
    for (const balance of snapshot.balances) {
        const key = toMatchKey(balance.name)
        // 銘柄を反映済みの証券口座は、合計を足すと同じ資産を二重に数えることになる。
        if (consumedAccounts.has(key)) continue

        if (keys.has(key) && !usedKeys.has(key)) {
            usedKeys.add(key)
            matched.push({ aliasKey: key, name: balance.name, amount: balance.amount })
            continue
        }
        unmatched.push(balance.name)
    }

    return { matched, unmatched }
}
