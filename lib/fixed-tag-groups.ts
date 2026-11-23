/**
 * 投資資産の分類（`TagGroup`）の種類はコードで固定する（Issue #1617）。
 * ユーザーが編集できるのは各分類の選択肢（`TagOption`）と、資産をどの選択肢に入れるか（`CategoryTag`）だけ。
 * 分類を足す・外すときはここを直し、既存データの扱いをマイグレーションで決める。
 */

export const FIXED_TAG_GROUPS = [
    { key: "ASSET_CLASS", name: "資産クラス", description: "何に投資しているか" },
    { key: "ACCOUNT", name: "投資口座", description: "どこで持っているか" },
    { key: "NISA", name: "NISA", description: "NISAでどれだけ持っているか" },
    { key: "DC", name: "企業型DC", description: "確定拠出年金でどれだけ持っているか" },
] as const

export type FixedTagGroupKey = (typeof FIXED_TAG_GROUPS)[number]["key"]

export function isFixedTagGroupKey(value: unknown): value is FixedTagGroupKey {
    return typeof value === "string" && FIXED_TAG_GROUPS.some((g) => g.key === value)
}

/** 固定の分類のうち、まだ作られていないもの（作る順＝表示順） */
export function missingFixedTagGroups(existingKeys: Iterable<string | null | undefined>) {
    const have = new Set(existingKeys)
    return FIXED_TAG_GROUPS.map((g, order) => ({ ...g, order })).filter((g) => !have.has(g.key))
}

/**
 * 固定の分類だけを固定の順に並べ、名前・説明はコードの定義で上書きする。
 * key の無い行（マイグレーション前の残り）は返さない。
 */
export function arrangeFixedTagGroups<T extends { key: string | null }>(groups: readonly T[]) {
    const byKey = new Map<string, T>()
    for (const g of groups) {
        if (g.key && !byKey.has(g.key)) byKey.set(g.key, g)
    }
    return FIXED_TAG_GROUPS.flatMap((def, order) => {
        const g = byKey.get(def.key)
        return g ? [{ ...g, key: def.key, name: def.name, description: def.description, order }] : []
    })
}
