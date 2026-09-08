/**
 * 目標配分の軸をまたぐ整合（#405）。
 *
 * 目標配分は「カテゴリ別」「タググループ別」と軸ごとに保存するが、どの軸も同じ1つの
 * 目標ポートフォリオを表す。カテゴリ別が最も細かい粒度なので、
 *
 * - カテゴリ別の目標があるとき、タグ軸の目標は「同じ選択肢に属するカテゴリの目標の合計」として算出する
 * - カテゴリ別の目標が無いとき、タグ軸同士は「両方を同時に満たすカテゴリ配分が存在する」場合だけ両立する
 *
 * ここには画面・DBを持ち込まず、純粋な計算だけを置く（`lib/rebalance.ts` と同じ方針）。
 * 親カテゴリの目標を選択肢へ按分するときは、子カテゴリを含めた現在の評価額の内訳比を使う
 * （子が親と違うタグを持てるため。ダッシュボードの構成比グラフと同じ解決規則）。
 */

import type {
    AllocationTargetRecord,
    RebalanceCategory,
    RebalanceTagGroup,
} from "./rebalance"

/** タグ選択肢のID。null は「未分類」（どの選択肢にも属さない） */
export type OptionKey = number | null

/** 目標比率の一致判定に使う許容誤差（%）。保存側の TARGET_SUM_TOLERANCE と揃える */
export const RATIO_TOLERANCE = 0.05

/** 比例フィッティングの反復回数の上限。カテゴリ数十件・軸数件なら十分に収束する */
const FIT_MAX_ITERATIONS = 2000
const FIT_EPSILON = 1e-4

/** 目標の無いカテゴリに与える種の重み。他の選択肢の比率を崩さない程度に小さくする */
const SEED_FLOOR = 1e-6

export function roundRatio(value: number): number {
    return Math.round(value * 10) / 10
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value)
}

/**
 * カテゴリに効いているタグ選択肢を求める。
 * 直接の設定が無ければ親をたどる（ダッシュボードの構成比グラフと同じ規則）。
 */
export function findEffectiveTagOptionId(
    category: RebalanceCategory,
    categoryById: Map<number, RebalanceCategory>,
    tagGroupId: number,
): number | null {
    let current: RebalanceCategory | undefined = category
    const visited = new Set<number>()

    while (current && !visited.has(current.id)) {
        visited.add(current.id)
        const setting = current.tagSettings?.find((s) => s.groupId === tagGroupId)
        if (setting?.optionId != null) return setting.optionId
        current = current.parentId != null ? categoryById.get(current.parentId) : undefined
    }

    return null
}

/** カテゴリの最上位の親（自分が最上位なら自分）。循環していたら null */
function findRoot(
    category: RebalanceCategory,
    categoryById: Map<number, RebalanceCategory>,
): RebalanceCategory | null {
    let current: RebalanceCategory | undefined = category
    const visited = new Set<number>()
    while (current) {
        if (visited.has(current.id)) return null
        visited.add(current.id)
        if (current.parentId == null) return current
        current = categoryById.get(current.parentId)
    }
    return null
}

/** リバランスの対象になる最上位カテゴリ（負債を除く） */
export function topLevelCategories(categories: RebalanceCategory[]): RebalanceCategory[] {
    return categories.filter((c) => c.parentId == null && !c.isLiability)
}

/**
 * タググループの選択肢ごとの「所属の割合」。最上位カテゴリID → 選択肢キー → 割合（合計1）。
 *
 * 子カテゴリを含めた評価額（ownValue）を、それぞれに効いている選択肢へ振り分けて求める。
 * 評価額が0のカテゴリは、そのカテゴリ自身に効いている選択肢へ全部を割り当てる。
 */
export type MembershipMap = Map<number, Map<OptionKey, number>>

export function computeMemberships(
    categories: RebalanceCategory[],
    tagGroupId: number,
): MembershipMap {
    const categoryById = new Map(categories.map((c) => [c.id, c]))
    const roots = topLevelCategories(categories)
    const rootIds = new Set(roots.map((r) => r.id))
    const valueByRoot = new Map<number, Map<OptionKey, number>>()

    for (const cat of categories) {
        if (cat.isLiability) continue
        const ownValue = isFiniteNumber(cat.ownValue) ? cat.ownValue : 0
        if (ownValue <= 0) continue
        const root = findRoot(cat, categoryById)
        if (!root || !rootIds.has(root.id)) continue

        const key = findEffectiveTagOptionId(cat, categoryById, tagGroupId)
        const bucket = valueByRoot.get(root.id) ?? new Map<OptionKey, number>()
        bucket.set(key, (bucket.get(key) ?? 0) + ownValue)
        valueByRoot.set(root.id, bucket)
    }

    const memberships: MembershipMap = new Map()
    for (const root of roots) {
        const bucket = valueByRoot.get(root.id)
        const total = bucket ? [...bucket.values()].reduce((sum, v) => sum + v, 0) : 0
        if (!bucket || total <= 0) {
            memberships.set(root.id, new Map([[findEffectiveTagOptionId(root, categoryById, tagGroupId), 1]]))
            continue
        }
        memberships.set(root.id, new Map([...bucket].map(([key, v]) => [key, v / total])))
    }
    return memberships
}

/** カテゴリ別の目標。カテゴリID → 比率と除外指定 */
export type CategoryTargetMap = Map<number, { ratio: number; excluded: boolean }>

export function categoryTargetsOf(targets: AllocationTargetRecord[]): CategoryTargetMap {
    const map: CategoryTargetMap = new Map()
    for (const t of targets) {
        if (t.categoryId == null) continue
        map.set(t.categoryId, {
            ratio: t.excluded ? 0 : (isFiniteNumber(t.ratio) ? t.ratio : 0),
            excluded: t.excluded === true,
        })
    }
    return map
}

/** カテゴリ別の目標（除外だけでなく比率）がひとつでも保存されているか */
export function hasCategoryTargets(targets: AllocationTargetRecord[]): boolean {
    return targets.some((t) => t.categoryId != null && !t.excluded)
}

/** タグ軸に保存されている行（そのグループのもの）。除外の行も含む */
export function tagTargetsOf(
    targets: AllocationTargetRecord[],
    tagGroupId: number,
): Map<OptionKey, { ratio: number; excluded: boolean }> {
    const map = new Map<OptionKey, { ratio: number; excluded: boolean }>()
    for (const t of targets) {
        if (t.tagGroupId !== tagGroupId) continue
        map.set(t.tagOptionId ?? null, {
            ratio: t.excluded ? 0 : (isFiniteNumber(t.ratio) ? t.ratio : 0),
            excluded: t.excluded === true,
        })
    }
    return map
}

/** タグ軸に比率の目標（除外以外）が保存されているか */
export function hasTagTargets(targets: AllocationTargetRecord[], tagGroupId: number): boolean {
    return targets.some((t) => t.tagGroupId === tagGroupId && t.tagOptionId != null && !t.excluded)
}

export interface DerivedTagTarget {
    key: OptionKey
    /** 算出した目標比率(%)。除外の行は 0 */
    ratio: number
    /** 選択肢に属するカテゴリがすべてカテゴリ別で除外されている */
    excluded: boolean
    /** 比率の内訳（カテゴリ別の目標 × 所属の割合）。0のものは含めない */
    parts: { categoryId: number; ratio: number }[]
}

/**
 * カテゴリ別の目標から、タググループの選択肢ごとの目標を算出する。
 * 目標を持つ最上位カテゴリが1つも無い選択肢は返さない（評価額0で目標も無い行を増やさないため）。
 */
export function deriveTagTargets(
    categories: RebalanceCategory[],
    categoryTargets: CategoryTargetMap,
    tagGroupId: number,
): DerivedTagTarget[] {
    const memberships = computeMemberships(categories, tagGroupId)
    const acc = new Map<OptionKey, { ratio: number; included: boolean; touched: boolean; parts: { categoryId: number; ratio: number }[] }>()

    for (const [categoryId, shares] of memberships) {
        const target = categoryTargets.get(categoryId)
        if (!target) continue
        for (const [key, share] of shares) {
            if (share <= 0) continue
            const entry = acc.get(key) ?? { ratio: 0, included: false, touched: false, parts: [] }
            entry.touched = true
            if (!target.excluded) {
                entry.included = true
                const part = target.ratio * share
                entry.ratio += part
                if (part > 0) entry.parts.push({ categoryId, ratio: part })
            }
            acc.set(key, entry)
        }
    }

    return [...acc]
        .filter(([, entry]) => entry.touched)
        .map(([key, entry]) => ({
            key,
            ratio: entry.included ? entry.ratio : 0,
            excluded: !entry.included,
            parts: entry.parts,
        }))
}

/** 算出したタグ軸の目標を、`buildAllocationRows` が読む形（保存済みの行と同じ形）にする */
export function derivedTagTargetRecords(
    categories: RebalanceCategory[],
    targets: AllocationTargetRecord[],
    tagGroupId: number,
): AllocationTargetRecord[] {
    return deriveTagTargets(categories, categoryTargetsOf(targets), tagGroupId).map((d) => ({
        categoryId: null,
        tagGroupId,
        tagOptionId: d.key,
        ratio: d.ratio,
        excluded: d.excluded,
    }))
}

/** 比率を小数第1位に丸めつつ、合計をぴったり100にする（端数は最大の項目で吸収） */
export function roundToHundred<T extends { ratio: number }>(entries: T[]): T[] {
    if (!entries.length) return entries
    const rounded = entries.map((e) => ({ ...e, ratio: roundRatio(e.ratio) }))
    const diff = roundRatio(100 - rounded.reduce((sum, e) => sum + e.ratio, 0))
    if (diff !== 0) {
        let largest = 0
        for (let i = 1; i < entries.length; i++) {
            if (entries[i].ratio > entries[largest].ratio) largest = i
        }
        rounded[largest] = { ...rounded[largest], ratio: roundRatio(rounded[largest].ratio + diff) }
    }
    return rounded
}

/** タグ軸1つぶんの制約。選択肢キー → 目標比率(%)。載っていないキーは制約しない */
export interface AxisConstraint {
    tagGroupId: number
    targets: Map<OptionKey, number>
}

export interface FitResult {
    /** カテゴリID → 比率(%)。合計100 */
    ratios: Map<number, number>
    /** 制約からの最大のズレ(pt)。RATIO_TOLERANCE 未満なら制約をすべて満たしている */
    maxError: number
    feasible: boolean
}

/**
 * タグ軸の制約をすべて満たすカテゴリ配分を、種（seed）に最も近い形で求める（比例フィッティング）。
 * 各軸について「算出値 / 目標」の比で重みを補正することを繰り返す。所属が按分されている
 * カテゴリは割合の分だけ補正する（一般化反復スケーリング）。
 * 解が存在しなければ収束せず、maxError が許容誤差を超えたまま返る。
 */
export function fitCategoryRatios(params: {
    categoryIds: number[]
    memberships: Map<number, MembershipMap>
    constraints: AxisConstraint[]
    seed: Map<number, number>
}): FitResult {
    const { categoryIds, memberships, constraints, seed } = params
    const weights = new Map<number, number>()
    for (const id of categoryIds) {
        const s = seed.get(id)
        weights.set(id, isFiniteNumber(s) && s > 0 ? s : SEED_FLOOR)
    }

    const normalize = () => {
        const total = [...weights.values()].reduce((sum, w) => sum + w, 0)
        if (total <= 0) return
        for (const [id, w] of weights) weights.set(id, (w / total) * 100)
    }
    normalize()

    const marginalsOf = (constraint: AxisConstraint): Map<OptionKey, number> => {
        const map = new Map<OptionKey, number>()
        const shares = memberships.get(constraint.tagGroupId)
        for (const id of categoryIds) {
            const w = weights.get(id) ?? 0
            for (const [key, share] of shares?.get(id) ?? []) {
                if (share <= 0) continue
                map.set(key, (map.get(key) ?? 0) + w * share)
            }
        }
        return map
    }

    const errorOf = (): number => {
        let max = 0
        for (const c of constraints) {
            const m = marginalsOf(c)
            for (const [key, target] of c.targets) {
                max = Math.max(max, Math.abs((m.get(key) ?? 0) - target))
            }
        }
        return max
    }

    let maxError = errorOf()
    for (let i = 0; i < FIT_MAX_ITERATIONS && maxError >= FIT_EPSILON; i++) {
        for (const c of constraints) {
            const m = marginalsOf(c)
            const shares = memberships.get(c.tagGroupId)
            for (const id of categoryIds) {
                let factor = 1
                for (const [key, share] of shares?.get(id) ?? []) {
                    if (share <= 0 || !c.targets.has(key)) continue
                    const current = m.get(key) ?? 0
                    const target = c.targets.get(key) ?? 0
                    if (current <= 0) continue
                    factor *= Math.pow(target / current, share)
                }
                weights.set(id, (weights.get(id) ?? 0) * factor)
            }
            normalize()
        }
        maxError = errorOf()
    }

    return { ratios: weights, maxError, feasible: maxError < RATIO_TOLERANCE }
}

/** フィッティングに使う「現在の評価額」の種。評価額0のカテゴリも僅かに残して配分を受けられるようにする */
export function seedFromCurrentValues(categories: RebalanceCategory[]): Map<number, number> {
    const seed = new Map<number, number>()
    for (const c of topLevelCategories(categories)) {
        const v = isFiniteNumber(c.currentValue) && c.currentValue > 0 ? c.currentValue : 0
        seed.set(c.id, v > 0 ? v : SEED_FLOOR)
    }
    return seed
}

/**
 * タグ軸の保存済みの行から制約を作る。
 * 除外していない選択肢はすべて制約する（目標の無い選択肢と、除外していない未分類は 0%）。
 * 除外した選択肢は制約しない。
 */
export function constraintFromTagTargets(
    memberships: MembershipMap,
    tagGroupId: number,
    tagTargets: Map<OptionKey, { ratio: number; excluded: boolean }>,
): AxisConstraint {
    const keys = new Set<OptionKey>()
    for (const shares of memberships.values()) {
        for (const [key, share] of shares) if (share > 0) keys.add(key)
    }
    for (const key of tagTargets.keys()) keys.add(key)

    const targets = new Map<OptionKey, number>()
    for (const key of keys) {
        const t = tagTargets.get(key)
        if (t?.excluded) continue
        targets.set(key, t?.ratio ?? 0)
    }
    return { tagGroupId, targets }
}

/**
 * 判定に使うカテゴリ。所属がすべて除外した選択肢に入っているカテゴリは母数から外す
 * （軸ごとに除外の指定が違うときは、どこかの軸で除外した資産を全軸から外した前提で判定する）。
 */
function includedCategoryIds(
    categories: RebalanceCategory[],
    memberships: Map<number, MembershipMap>,
    excludedKeys: Map<number, Set<OptionKey>>,
    excludedCategoryIds: Set<number>,
): number[] {
    return topLevelCategories(categories)
        .filter((c) => !excludedCategoryIds.has(c.id))
        .filter((c) => {
            for (const [groupId, keys] of excludedKeys) {
                const shares = memberships.get(groupId)?.get(c.id)
                if (!shares) continue
                let excludedShare = 0
                for (const [key, share] of shares) if (keys.has(key)) excludedShare += share
                if (excludedShare >= 1 - 1e-9) return false
            }
            return true
        })
        .map((c) => c.id)
}

export interface TagAxisInput {
    tagGroupId: number
    /** 保存しようとしている行。除外の行も含む */
    items: { key: OptionKey; ratio: number; excluded: boolean }[]
}

/**
 * タグ軸に保存しようとしている目標が、他のタグ軸に保存済みの目標と両立するか
 * （カテゴリ別の目標が無いときに使う）。両立しない場合、単独で両立しない相手の軸の名前を返す。
 */
export function checkTagAxisCompatibility(params: {
    categories: RebalanceCategory[]
    tagGroups: RebalanceTagGroup[]
    targets: AllocationTargetRecord[]
    input: TagAxisInput
}): { compatible: boolean; conflictingGroups: string[] } {
    const { categories, tagGroups, targets, input } = params
    const otherGroups = tagGroups.filter((g) => g.id !== input.tagGroupId && hasTagTargets(targets, g.id))
    if (!otherGroups.length) return { compatible: true, conflictingGroups: [] }

    const memberships = new Map<number, MembershipMap>()
    for (const g of tagGroups) memberships.set(g.id, computeMemberships(categories, g.id))

    const inputTargets = new Map<OptionKey, { ratio: number; excluded: boolean }>(
        input.items.map((i) => [i.key, { ratio: i.excluded ? 0 : i.ratio, excluded: i.excluded }]),
    )
    const own = constraintFromTagTargets(memberships.get(input.tagGroupId)!, input.tagGroupId, inputTargets)
    const excludedKeys = new Map<number, Set<OptionKey>>()
    excludedKeys.set(input.tagGroupId, new Set([...inputTargets].filter(([, t]) => t.excluded).map(([k]) => k)))

    const others = otherGroups.map((g) => {
        const stored = tagTargetsOf(targets, g.id)
        excludedKeys.set(g.id, new Set([...stored].filter(([, t]) => t.excluded).map(([k]) => k)))
        return { group: g, constraint: constraintFromTagTargets(memberships.get(g.id)!, g.id, stored) }
    })

    const seed = seedFromCurrentValues(categories)
    const run = (constraints: AxisConstraint[]) =>
        fitCategoryRatios({
            categoryIds: includedCategoryIds(categories, memberships, excludedKeys, new Set()),
            memberships,
            constraints,
            seed,
        }).feasible

    if (run([own, ...others.map((o) => o.constraint)])) return { compatible: true, conflictingGroups: [] }

    const conflictingGroups = others
        .filter((o) => !run([own, o.constraint]))
        .map((o) => o.group.name)
    return { compatible: false, conflictingGroups }
}

export interface OptionBound {
    key: OptionKey
    min: number
    max: number
    /** 上限を決めている軸と、その内訳（選択肢名と目標比率） */
    maxSource: { groupName: string; parts: { name: string; ratio: number }[] } | null
    /** 下限を決めている軸と、その内訳 */
    minSource: { groupName: string; parts: { name: string; ratio: number }[] } | null
}

/**
 * タグ軸の各選択肢が取り得る範囲を、他のタグ軸の保存済みの目標から求める（必要条件）。
 * 上限: 相手の軸で、この選択肢と同じカテゴリを共有する選択肢の目標の合計。
 * 下限: 相手の軸で、属するカテゴリがすべてこの選択肢に丸ごと入っている選択肢の目標の合計。
 * 複数の軸があるときは、上限は最小、下限は最大を取る。
 */
export function computeOptionBounds(params: {
    categories: RebalanceCategory[]
    tagGroups: RebalanceTagGroup[]
    targets: AllocationTargetRecord[]
    tagGroupId: number
}): Map<OptionKey, OptionBound> {
    const { categories, tagGroups, targets, tagGroupId } = params
    const ownShares = computeMemberships(categories, tagGroupId)
    const ownKeys = new Set<OptionKey>()
    for (const shares of ownShares.values()) for (const [key, share] of shares) if (share > 0) ownKeys.add(key)

    const bounds = new Map<OptionKey, OptionBound>()
    for (const key of ownKeys) bounds.set(key, { key, min: 0, max: 100, maxSource: null, minSource: null })

    for (const group of tagGroups) {
        if (group.id === tagGroupId || !hasTagTargets(targets, group.id)) continue
        const stored = tagTargetsOf(targets, group.id)
        const otherShares = computeMemberships(categories, group.id)
        const nameOf = (k: OptionKey) => (k == null ? "未分類" : group.options?.find((o) => o.id === k)?.name ?? `選択肢${k}`)

        for (const key of ownKeys) {
            const adjacent: { name: string; ratio: number }[] = []
            const contained: { name: string; ratio: number }[] = []
            for (const [otherKey, t] of stored) {
                if (t.excluded || t.ratio <= 0) continue
                let shares = false
                let whole = true
                let members = 0
                for (const [catId, other] of otherShares) {
                    const inOther = other.get(otherKey) ?? 0
                    if (inOther <= 0) continue
                    members++
                    const inOwn = ownShares.get(catId)?.get(key) ?? 0
                    if (inOwn > 0) shares = true
                    if (inOwn < 1 - 1e-9) whole = false
                }
                if (shares) adjacent.push({ name: nameOf(otherKey), ratio: t.ratio })
                if (members > 0 && whole) contained.push({ name: nameOf(otherKey), ratio: t.ratio })
            }
            const max = adjacent.reduce((sum, p) => sum + p.ratio, 0)
            const min = contained.reduce((sum, p) => sum + p.ratio, 0)
            const bound = bounds.get(key)!
            if (max < bound.max - 1e-9) {
                bound.max = max
                bound.maxSource = { groupName: group.name, parts: adjacent }
            }
            if (min > bound.min + 1e-9) {
                bound.min = min
                bound.minSource = { groupName: group.name, parts: contained }
            }
        }
    }
    return bounds
}

/**
 * タグ軸の目標を満たすカテゴリ別の配分を作る（「タグ別の目標に合わせて配分」）。
 * 種は現在の評価額（seed を渡せばそちら）。除外したカテゴリは配分しない。
 * 両立しなければ null。
 */
export function fitCategoryTargetsToTagTargets(params: {
    categories: RebalanceCategory[]
    tagGroups: RebalanceTagGroup[]
    targets: AllocationTargetRecord[]
    excludedCategoryIds?: Set<number>
    seed?: Map<number, number>
}): { categoryId: number; ratio: number }[] | null {
    const { categories, tagGroups, targets } = params
    const groups = tagGroups.filter((g) => hasTagTargets(targets, g.id))
    if (!groups.length) return null

    const memberships = new Map<number, MembershipMap>()
    for (const g of tagGroups) memberships.set(g.id, computeMemberships(categories, g.id))
    const excludedKeys = new Map<number, Set<OptionKey>>()
    const constraints = groups.map((g) => {
        const stored = tagTargetsOf(targets, g.id)
        excludedKeys.set(g.id, new Set([...stored].filter(([, t]) => t.excluded).map(([k]) => k)))
        return constraintFromTagTargets(memberships.get(g.id)!, g.id, stored)
    })
    const categoryIds = includedCategoryIds(categories, memberships, excludedKeys, params.excludedCategoryIds ?? new Set())
    if (!categoryIds.length) return null

    const result = fitCategoryRatios({
        categoryIds,
        memberships,
        constraints,
        seed: params.seed ?? seedFromCurrentValues(categories),
    })
    if (!result.feasible) return null
    return roundToHundred(categoryIds.map((id) => ({ categoryId: id, ratio: result.ratios.get(id) ?? 0 })))
}

/**
 * カテゴリ別の目標があるときに、タグ軸で指定し直した比率へカテゴリ別の目標を寄せる。
 * 各選択肢に属するカテゴリの目標を、いまの目標に比例して調整する（他の選択肢との共有部分は按分）。
 * 除外したカテゴリは触らない。未分類の比率は算出値のまま固定する。
 * 両立しない（例: 属するカテゴリの目標が全部0の選択肢を増やす）場合は null。
 */
export function rescaleCategoryTargets(params: {
    categories: RebalanceCategory[]
    targets: AllocationTargetRecord[]
    tagGroupId: number
    /** 選択肢ID → 新しい比率(%)。未分類（null）は渡さなくてよい */
    ratios: Map<number, number>
}): { categoryId: number; ratio: number }[] | null {
    const { categories, targets, tagGroupId, ratios } = params
    const categoryTargets = categoryTargetsOf(targets)
    const memberships = computeMemberships(categories, tagGroupId)
    const categoryIds = topLevelCategories(categories)
        .filter((c) => !categoryTargets.get(c.id)?.excluded)
        .map((c) => c.id)
    if (!categoryIds.length) return null

    const derived = new Map(deriveTagTargets(categories, categoryTargets, tagGroupId).map((d) => [d.key, d]))
    const constraintTargets = new Map<OptionKey, number>()
    for (const shares of memberships.values()) {
        for (const [key, share] of shares) {
            if (share <= 0 || constraintTargets.has(key)) continue
            if (key == null) {
                constraintTargets.set(null, derived.get(null)?.ratio ?? 0)
            } else {
                constraintTargets.set(key, ratios.get(key) ?? derived.get(key)?.ratio ?? 0)
            }
        }
    }

    // 目標0のカテゴリには現在の評価額に応じた僅かな種を残し、必要なときだけ配分を受けられるようにする
    const seed = new Map<number, number>()
    const total = topLevelCategories(categories).reduce((sum, c) => sum + Math.max(0, c.currentValue || 0), 0)
    for (const id of categoryIds) {
        const ratio = categoryTargets.get(id)?.ratio ?? 0
        const value = categories.find((c) => c.id === id)?.currentValue ?? 0
        seed.set(id, ratio > 0 ? ratio : SEED_FLOOR * (total > 0 ? 1 + (value / total) * 1000 : 1))
    }

    const result = fitCategoryRatios({
        categoryIds,
        memberships: new Map([[tagGroupId, memberships]]),
        constraints: [{ tagGroupId, targets: constraintTargets }],
        seed,
    })
    if (!result.feasible) return null
    return roundToHundred(categoryIds.map((id) => ({ categoryId: id, ratio: result.ratios.get(id) ?? 0 })))
}

export interface TagMismatch {
    tagGroupId: number
    groupName: string
    key: OptionKey
    name: string
    /** カテゴリ別から算出した値（除外なら null） */
    derived: number | null
    /** タグ軸に保存されている値（除外なら null） */
    stored: number | null
}

/**
 * カテゴリ別の目標（保存しようとしている内容）と、タグ軸に保存済みの目標の食い違い。
 * タグ軸に比率の目標が無いグループは見ない。
 */
export function findTagMismatches(params: {
    categories: RebalanceCategory[]
    tagGroups: RebalanceTagGroup[]
    targets: AllocationTargetRecord[]
    categoryTargets: CategoryTargetMap
}): TagMismatch[] {
    const { categories, tagGroups, targets, categoryTargets } = params
    const mismatches: TagMismatch[] = []
    for (const group of tagGroups) {
        if (!hasTagTargets(targets, group.id)) continue
        const stored = tagTargetsOf(targets, group.id)
        const derived = new Map(deriveTagTargets(categories, categoryTargets, group.id).map((d) => [d.key, d]))
        const keys = new Set<OptionKey>([...stored.keys(), ...derived.keys()])
        for (const key of keys) {
            const s = stored.get(key)
            const d = derived.get(key)
            const storedRatio = s && !s.excluded ? s.ratio : null
            const derivedRatio = d && !d.excluded ? d.ratio : null
            // 未分類は保存側で目標を持てない。算出値が0（または無い）なら食い違いではない
            const storedValue = storedRatio ?? (key == null && !s?.excluded ? 0 : null)
            const derivedValue = derivedRatio ?? (d ? null : 0)
            if (storedValue == null && derivedValue == null) continue
            if (storedValue != null && derivedValue != null && Math.abs(storedValue - derivedValue) <= RATIO_TOLERANCE) continue
            if (storedValue == null && derivedValue === 0) continue
            if (derivedValue == null && storedValue === 0) continue
            mismatches.push({
                tagGroupId: group.id,
                groupName: group.name,
                key,
                name: key == null ? "未分類" : group.options?.find((o) => o.id === key)?.name ?? `選択肢${key}`,
                derived: derivedRatio,
                stored: storedRatio,
            })
        }
    }
    return mismatches
}

/**
 * 保存済みの目標のうち、両立しない組み合わせ（画面上部の注意に使う）。
 * カテゴリ別の目標があるときはタグ軸が算出値になるので矛盾は起きない。
 */
export function findStoredConflicts(params: {
    categories: RebalanceCategory[]
    tagGroups: RebalanceTagGroup[]
    targets: AllocationTargetRecord[]
}): { groupName: string; conflictingGroups: string[] }[] {
    const { categories, tagGroups, targets } = params
    if (hasCategoryTargets(targets)) return []
    const groups = tagGroups.filter((g) => hasTagTargets(targets, g.id))
    if (groups.length < 2) return []

    const conflicts: { groupName: string; conflictingGroups: string[] }[] = []
    const seen = new Set<string>()
    for (const group of groups) {
        const stored = tagTargetsOf(targets, group.id)
        const result = checkTagAxisCompatibility({
            categories,
            tagGroups,
            targets: targets.filter((t) => t.tagGroupId !== group.id),
            input: {
                tagGroupId: group.id,
                items: [...stored].map(([key, t]) => ({ key, ratio: t.ratio, excluded: t.excluded })),
            },
        })
        if (result.compatible) continue
        const pairKey = [group.name, ...result.conflictingGroups].sort().join(" ")
        if (seen.has(pairKey)) continue
        seen.add(pairKey)
        conflicts.push({ groupName: group.name, conflictingGroups: result.conflictingGroups })
    }
    return conflicts
}
