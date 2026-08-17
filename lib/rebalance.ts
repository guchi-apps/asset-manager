/**
 * 目標配分（AllocationTarget）と現在の資産配分を突き合わせ、
 * 目標とのズレと、それを埋めるための売買金額を算出する。
 *
 * 画面から切り離した純粋な計算だけを置く（DBアクセス・Reactを持ち込まない）。
 */

/** リバランスの集計軸。カテゴリ別か、タググループ（資産クラス・通貨など）別。 */
export type RebalanceAxis =
    | { kind: "category" }
    | { kind: "tagGroup"; tagGroupId: number }

/** 提案の出し方。買い増しのみ（売らない）か、売買あり（目標ちょうどに合わせる）か。 */
export type ProposalMode = "buyOnly" | "buySell"

export interface RebalanceCategory {
    id: number
    name: string
    color?: string
    parentId?: number | null
    currentValue: number
    ownValue?: number
    isCash?: boolean
    isLiability?: boolean
    tagSettings?: { groupId: number; optionId: number | null; optionName?: string }[]
}

export interface RebalanceTagGroup {
    id: number
    name: string
    options?: { id: number; name: string }[]
}

export interface AllocationTargetRecord {
    categoryId: number | null
    tagGroupId: number | null
    tagOptionId: number | null
    ratio: number
}

export interface AllocationRow {
    /** 行の識別子（"category:3" / "tagOption:12" / "unassigned"） */
    key: string
    /** カテゴリID または タグ選択肢ID。未分類行は null */
    id: number | null
    name: string
    color: string
    /** 取引履歴への引き継ぎに使う。カテゴリ軸のときだけ値が入る */
    categoryId: number | null
    currentValue: number
    /** 総資産に対する構成比(%) */
    currentRatio: number
    /** 目標比率(%)。未設定は null */
    targetRatio: number | null
    /** currentRatio - targetRatio（pt）。目標未設定は null */
    driftPt: number | null
    /** 目標額。目標未設定は null */
    targetValue: number | null
    /** 目標額 - 現在額（プラスなら買い増し）。目標未設定は null */
    diffValue: number | null
    /** タグ軸で、どのタグにも属さない資産をまとめた行 */
    isUnassigned: boolean
}

export interface AllocationView {
    rows: AllocationRow[]
    /** 負債を除いた総資産 */
    totalValue: number
    /** 目標がひとつでも設定されているか */
    hasTargets: boolean
    /** 目標比率の合計(%) */
    targetSum: number
}

export interface ProposalItem {
    key: string
    name: string
    color: string
    categoryId: number | null
    /** プラスなら買い増し、マイナスなら売却 */
    amount: number
}

export interface ProposalResult {
    items: ProposalItem[]
    /** 買い増し合計 */
    buyTotal: number
    /** 売却合計（正の数） */
    sellTotal: number
    /** 提案前の最大のズレ（絶対値・pt） */
    maxDriftBefore: number
    /** 提案どおりに動かした後の最大のズレ（絶対値・pt） */
    maxDriftAfter: number
    /** 買い増しのみモードで、目標に届かせるために必要な不足合計 */
    shortfallTotal: number
    /** 丸め単位に満たず「変更しない」に寄せた件数 */
    skippedCount: number
}

/** 金額の丸め単位（円） */
export const DEFAULT_MIN_UNIT = 1000

/** 「要調整」と判定するズレ（pt）の既定値 */
export const DEFAULT_DRIFT_THRESHOLD = 5

const CHART_COLOR_COUNT = 12

function chartColor(index: number): string {
    return `var(--chart-${(((index % CHART_COLOR_COUNT) + CHART_COLOR_COUNT) % CHART_COLOR_COUNT) + 1})`
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value)
}

function ratioOf(value: number, total: number): number {
    return total > 0 ? (value / total) * 100 : 0
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

function findTarget(
    targets: AllocationTargetRecord[],
    axis: RebalanceAxis,
    id: number,
): number | null {
    const hit = axis.kind === "category"
        ? targets.find((t) => t.categoryId === id)
        : targets.find((t) => t.tagGroupId === axis.tagGroupId && t.tagOptionId === id)

    return hit && isFiniteNumber(hit.ratio) ? hit.ratio : null
}

/** 負債を除いた総資産。カテゴリの評価額は親に集約済みなのでトップレベルだけを足す。 */
export function sumTotalValue(categories: RebalanceCategory[]): number {
    return categories
        .filter((c) => c.parentId == null && !c.isLiability)
        .reduce((sum, c) => sum + (isFiniteNumber(c.currentValue) ? c.currentValue : 0), 0)
}

/** 集計軸ごとに、現在の構成比と目標とのズレを並べる。 */
export function buildAllocationRows(params: {
    categories: RebalanceCategory[]
    tagGroups: RebalanceTagGroup[]
    targets: AllocationTargetRecord[]
    axis: RebalanceAxis
}): AllocationView {
    const { categories, tagGroups, targets, axis } = params
    const totalValue = sumTotalValue(categories)

    const rawRows: AllocationRow[] = axis.kind === "category"
        ? buildCategoryRows(categories, targets, totalValue)
        : buildTagRows(categories, tagGroups, targets, axis.tagGroupId, totalValue)

    const rows = rawRows.filter((r) => r.currentValue > 0 || r.targetRatio != null)
    const targetSum = rows.reduce((sum, r) => sum + (r.targetRatio ?? 0), 0)

    return {
        rows,
        totalValue,
        hasTargets: rows.some((r) => r.targetRatio != null),
        targetSum,
    }
}

function toRow(params: {
    key: string
    id: number | null
    name: string
    color: string
    categoryId: number | null
    currentValue: number
    targetRatio: number | null
    totalValue: number
    isUnassigned?: boolean
}): AllocationRow {
    const { targetRatio, totalValue, currentValue } = params
    const currentRatio = ratioOf(currentValue, totalValue)
    const targetValue = targetRatio != null ? (totalValue * targetRatio) / 100 : null

    return {
        key: params.key,
        id: params.id,
        name: params.name,
        color: params.color,
        categoryId: params.categoryId,
        currentValue,
        currentRatio,
        targetRatio,
        driftPt: targetRatio != null ? currentRatio - targetRatio : null,
        targetValue,
        diffValue: targetValue != null ? targetValue - currentValue : null,
        isUnassigned: params.isUnassigned ?? false,
    }
}

function buildCategoryRows(
    categories: RebalanceCategory[],
    targets: AllocationTargetRecord[],
    totalValue: number,
): AllocationRow[] {
    return categories
        .filter((c) => c.parentId == null && !c.isLiability)
        .map((c, index) =>
            toRow({
                key: `category:${c.id}`,
                id: c.id,
                name: c.name,
                color: c.color || chartColor(index),
                categoryId: c.id,
                currentValue: isFiniteNumber(c.currentValue) ? c.currentValue : 0,
                targetRatio: findTarget(targets, { kind: "category" }, c.id),
                totalValue,
            }),
        )
}

function buildTagRows(
    categories: RebalanceCategory[],
    tagGroups: RebalanceTagGroup[],
    targets: AllocationTargetRecord[],
    tagGroupId: number,
    totalValue: number,
): AllocationRow[] {
    const group = tagGroups.find((g) => g.id === tagGroupId)
    if (!group) return []

    const categoryById = new Map(categories.map((c) => [c.id, c]))
    const valueByOption = new Map<number, number>()
    let unassigned = 0

    for (const cat of categories) {
        if (cat.isLiability) continue
        // 子を持つカテゴリの ownValue は 0 になっているため、二重計上にはならない
        const ownValue = isFiniteNumber(cat.ownValue) ? cat.ownValue : 0
        if (ownValue === 0) continue

        const optionId = findEffectiveTagOptionId(cat, categoryById, tagGroupId)
        if (optionId == null) {
            unassigned += ownValue
            continue
        }
        valueByOption.set(optionId, (valueByOption.get(optionId) ?? 0) + ownValue)
    }

    const rows = (group.options ?? []).map((option, index) =>
        toRow({
            key: `tagOption:${option.id}`,
            id: option.id,
            name: option.name,
            color: chartColor(index),
            categoryId: null,
            currentValue: valueByOption.get(option.id) ?? 0,
            targetRatio: findTarget(targets, { kind: "tagGroup", tagGroupId }, option.id),
            totalValue,
        }),
    )

    if (unassigned > 0) {
        rows.push(
            toRow({
                key: "unassigned",
                id: null,
                name: "未分類",
                color: "var(--muted-foreground)",
                categoryId: null,
                currentValue: unassigned,
                targetRatio: null,
                totalValue,
                isUnassigned: true,
            }),
        )
    }

    return rows
}

/**
 * 「要調整」と判定するか。
 * 画面に出る値（小数第1位まで）で判定するため、表示と判定が食い違わない。
 */
export function isAdjustNeeded(driftPt: number | null, threshold: number): boolean {
    if (driftPt == null) return false
    return Math.round(Math.abs(driftPt) * 10) / 10 >= threshold
}

/** 目標に合わせるために必要な売買額（売り側と買い側の大きい方）。 */
export function requiredTradeAmount(rows: AllocationRow[]): { buy: number; sell: number } {
    let buy = 0
    let sell = 0
    for (const row of rows) {
        if (row.diffValue == null) continue
        if (row.diffValue > 0) buy += row.diffValue
        else sell += -row.diffValue
    }
    return { buy, sell }
}

/** 目標とのズレが最も大きい行（絶対値で比較）。 */
export function findMaxDriftRow(rows: AllocationRow[]): AllocationRow | null {
    let found: AllocationRow | null = null
    for (const row of rows) {
        if (row.driftPt == null) continue
        if (!found || Math.abs(row.driftPt) > Math.abs(found.driftPt ?? 0)) found = row
    }
    return found
}

/**
 * 端数を丸めつつ、合計を expectedSum にぴったり合わせる。
 * 丸め単位に満たない項目は落とし、残った差は金額が最大の項目で吸収する。
 */
function normalizeAmounts(
    entries: { key: string; amount: number }[],
    expectedSum: number,
    unit: number,
): { kept: { key: string; amount: number }[]; skippedCount: number } {
    const meaningful = entries.filter((e) => Math.abs(e.amount) >= unit)
    const skippedCount = entries.length - meaningful.length
    if (!meaningful.length) return { kept: [], skippedCount }

    const rounded = meaningful.map((e) => ({
        key: e.key,
        amount: Math.round(e.amount / unit) * unit,
    }))

    const diff = expectedSum - rounded.reduce((sum, e) => sum + e.amount, 0)
    if (diff !== 0) {
        let largestIndex = 0
        for (let i = 1; i < rounded.length; i++) {
            if (Math.abs(meaningful[i].amount) > Math.abs(meaningful[largestIndex].amount)) {
                largestIndex = i
            }
        }
        rounded[largestIndex] = {
            ...rounded[largestIndex],
            amount: rounded[largestIndex].amount + diff,
        }
    }

    return { kept: rounded.filter((e) => e.amount !== 0), skippedCount }
}

/** 追加投資額の振り分け、または売買を含めたリバランスの提案を組み立てる。 */
export function buildProposal(params: {
    rows: AllocationRow[]
    totalValue: number
    extraAmount?: number
    mode: ProposalMode
    minUnit?: number
}): ProposalResult {
    const { rows, totalValue, mode } = params
    const minUnit = params.minUnit ?? DEFAULT_MIN_UNIT
    const extraAmount = Math.max(0, params.extraAmount ?? 0)

    const targeted = rows.filter((r) => r.targetRatio != null)
    const empty: ProposalResult = {
        items: [],
        buyTotal: 0,
        sellTotal: 0,
        maxDriftBefore: 0,
        maxDriftAfter: 0,
        shortfallTotal: 0,
        skippedCount: 0,
    }
    if (!targeted.length) return empty

    const newTotal = totalValue + extraAmount
    // 目標額との差。追加投資額を織り込んだうえで計算する
    const needs = targeted.map((row) => ({
        row,
        need: (newTotal * (row.targetRatio ?? 0)) / 100 - row.currentValue,
    }))
    const shortfallTotal = needs.reduce((sum, n) => sum + Math.max(0, n.need), 0)

    const maxDriftBefore = targeted.reduce(
        (max, r) => Math.max(max, Math.abs(r.driftPt ?? 0)),
        0,
    )

    let raw: { key: string; amount: number }[]

    if (mode === "buyOnly") {
        if (extraAmount <= 0) return { ...empty, maxDriftBefore, shortfallTotal }

        if (shortfallTotal <= 0) {
            // すべて目標以上。追加分は目標比率どおりに配る
            const ratioSum = targeted.reduce((sum, r) => sum + (r.targetRatio ?? 0), 0)
            raw = targeted.map((row) => ({
                key: row.key,
                amount: ratioSum > 0 ? (extraAmount * (row.targetRatio ?? 0)) / ratioSum : 0,
            }))
        } else if (extraAmount <= shortfallTotal) {
            raw = needs.map(({ row, need }) => ({
                key: row.key,
                amount: need > 0 ? (extraAmount * need) / shortfallTotal : 0,
            }))
        } else {
            // 不足をすべて埋めてもなお余る分は、目標比率どおりに配る
            const surplus = extraAmount - shortfallTotal
            const ratioSum = targeted.reduce((sum, r) => sum + (r.targetRatio ?? 0), 0)
            raw = needs.map(({ row, need }) => ({
                key: row.key,
                amount:
                    Math.max(0, need) +
                    (ratioSum > 0 ? (surplus * (row.targetRatio ?? 0)) / ratioSum : 0),
            }))
        }
    } else {
        raw = needs.map(({ row, need }) => ({ key: row.key, amount: need }))
    }

    // 買い増しのみは入力した追加投資額にぴったり合わせる。
    // 売買ありは、目標を持たない資産がある場合に差引きが追加投資額と一致しないため、
    // 算出した差額そのものを合計として保つ。
    const expectedSum = mode === "buyOnly"
        ? extraAmount
        : Math.round(raw.reduce((sum, e) => sum + e.amount, 0) / minUnit) * minUnit

    const { kept, skippedCount } = normalizeAmounts(raw, expectedSum, minUnit)
    const amountByKey = new Map(kept.map((e) => [e.key, e.amount]))

    const items: ProposalItem[] = targeted
        .filter((row) => amountByKey.has(row.key))
        .map((row) => ({
            key: row.key,
            name: row.name,
            color: row.color,
            categoryId: row.categoryId,
            amount: amountByKey.get(row.key) ?? 0,
        }))
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))

    const buyTotal = items.reduce((sum, i) => sum + Math.max(0, i.amount), 0)
    const sellTotal = items.reduce((sum, i) => sum + Math.max(0, -i.amount), 0)

    const maxDriftAfter = targeted.reduce((max, row) => {
        const after = row.currentValue + (amountByKey.get(row.key) ?? 0)
        const drift = ratioOf(after, newTotal) - (row.targetRatio ?? 0)
        return Math.max(max, Math.abs(drift))
    }, 0)

    return {
        items,
        buyTotal,
        sellTotal,
        maxDriftBefore,
        maxDriftAfter,
        shortfallTotal,
        skippedCount,
    }
}

/** 現在の構成比をそのまま目標として取り込むときの初期値（合計100%に丸める）。 */
export function targetsFromCurrentRatios(rows: AllocationRow[]): { key: string; ratio: number }[] {
    const assignable = rows.filter((r) => !r.isUnassigned)
    if (!assignable.length) return []

    const rounded = assignable.map((row) => ({
        key: row.key,
        ratio: Math.round(row.currentRatio * 10) / 10,
    }))

    const diff = Math.round((100 - rounded.reduce((sum, r) => sum + r.ratio, 0)) * 10) / 10
    if (diff !== 0) {
        let largestIndex = 0
        for (let i = 1; i < assignable.length; i++) {
            if (assignable[i].currentRatio > assignable[largestIndex].currentRatio) largestIndex = i
        }
        rounded[largestIndex] = {
            ...rounded[largestIndex],
            ratio: Math.round((rounded[largestIndex].ratio + diff) * 10) / 10,
        }
    }

    return rounded
}
