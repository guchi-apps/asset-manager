/** 口座タブのグループ分け（Issue #1035）。グループ名は口座ごとの文字列で、別テーブルは持たない */

export interface GroupableAccount {
    id: number
    groupName: string | null
}

export interface AccountGroup<T> {
    /** グループ名。null は未分類 */
    name: string | null
    accounts: T[]
    total: number
}

/**
 * 口座をグループごとにまとめる。入力の並び（表示順）を保ち、グループは「そのグループで最初に出た口座」の順、
 * 未分類は最後に置く。グループが1つも無ければ空配列（呼び出し側は従来の一覧のまま出す）。
 */
export function groupAccounts<T extends GroupableAccount>(accounts: T[], balanceOf: (account: T) => number): AccountGroup<T>[] {
    if (!accounts.some((a) => a.groupName)) return []
    const named = new Map<string, T[]>()
    const ungrouped: T[] = []
    for (const account of accounts) {
        if (!account.groupName) {
            ungrouped.push(account)
            continue
        }
        const list = named.get(account.groupName)
        if (list) list.push(account)
        else named.set(account.groupName, [account])
    }
    const toGroup = (name: string | null, list: T[]): AccountGroup<T> => ({
        name,
        accounts: list,
        total: list.reduce((sum, a) => sum + balanceOf(a), 0),
    })
    const groups = [...named.entries()].map(([name, list]) => toGroup(name, list))
    if (ungrouped.length > 0) groups.push(toGroup(null, ungrouped))
    return groups
}

/** 入力欄の候補にする、既存のグループ名（重複なし・出現順） */
export function existingGroupNames(accounts: GroupableAccount[]): string[] {
    return [...new Set(accounts.flatMap((a) => (a.groupName ? [a.groupName] : [])))]
}
