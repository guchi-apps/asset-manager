import {
    contentHash,
    naturalKeyOf,
    referencedItemIds,
    type ModelSpec,
    type NormalizedRow,
} from "./models"

/**
 * 移行元・移行先・取り込み記録（`LegacyImportRecord`）から、1ユーザー×1モデルぶんの書き込み計画を組む（Issue #717）。
 *
 * 取り込み記録には「取り込んだ時点の内容のハッシュ」を持たせてあり、移行元・移行先のどちらが変わったのかを
 * 見分けられる。
 *
 * | 移行元 | 移行先 | 計画 |
 * |---|---|---|
 * | 記録なし | 同じ id なし | 作成（同じキーの行が移行先にあれば衝突） |
 * | 記録なし | 同じ id で同じ内容 | 記録だけ付ける（`link`） |
 * | 記録なし | 同じ id で違う内容 | 衝突 |
 * | 記録と同じ | 記録と同じ | 何もしない（再実行） |
 * | 変わった | 記録と同じ | 更新（切替直前に旧アプリで直した分の差分取り込み） |
 * | 記録と同じ | 変わった・消えた | 移行先を残す（新アプリで直した分を巻き戻さない） |
 * | 変わった | 変わった | 同じ内容になっていれば記録だけ直す。違えば衝突 |
 * | 物理削除された | 記録と同じ | 移行先も消す |
 * | 物理削除された | 変わった | 衝突 |
 *
 * 衝突が1件でもあれば、そのユーザーには何も書き込まない（呼び出し側が止める）。
 */

export type ImportRecord = {
    sourceId: string
    targetId: string
    contentHash: string
}

export type PlannedAction =
    | { kind: "create"; sourceId: string; row: NormalizedRow; hash: string }
    | { kind: "update"; sourceId: string; row: NormalizedRow; hash: string }
    | { kind: "delete"; sourceId: string; targetId: string }
    | { kind: "link"; sourceId: string; hash: string }
    | { kind: "forgetRecord"; sourceId: string }
    | { kind: "unchanged"; sourceId: string }
    | { kind: "keepTarget"; sourceId: string; reason: string }
    | { kind: "conflict"; sourceId: string; reason: string }

export type ActionKind = PlannedAction["kind"]

export type ModelPlan = {
    spec: ModelSpec
    actions: PlannedAction[]
    /** 移行先にある、移行と無関係な行（新アプリで入力された行）の数 */
    targetOnlyCount: number
}

export type PlanInput = {
    spec: ModelSpec
    sourceRows: NormalizedRow[]
    /** 移行先ユーザーの行 */
    targetRows: NormalizedRow[]
    /** 移行元の id と同じ id を、移行先の**別のユーザー**が持っている行の id */
    foreignTargetIds: Set<string>
    records: ImportRecord[]
}

function describeKey(spec: ModelSpec, row: NormalizedRow): string {
    return spec.naturalKey
        .map((name) => {
            const value = row.fields[name]
            const text = typeof value === "string" && /T00:00:00\.000Z$/.test(value) ? value.slice(0, 10) : String(value)
            return `${name}=${text}`
        })
        .join(", ")
}

export function planModel(input: PlanInput): ModelPlan {
    const { spec, sourceRows, targetRows, foreignTargetIds, records } = input
    const targetById = new Map(targetRows.map((row) => [row.id, row]))
    const recordBySourceId = new Map(records.map((record) => [record.sourceId, record]))
    const sourceIds = new Set(sourceRows.map((row) => row.id))
    const actions: PlannedAction[] = []

    for (const source of sourceRows) {
        const hash = contentHash(source)
        const record = recordBySourceId.get(source.id)
        const target = targetById.get(record?.targetId ?? source.id)

        if (foreignTargetIds.has(source.id)) {
            actions.push({
                kind: "conflict",
                sourceId: source.id,
                reason: "同じ id の行が移行先の別のユーザーにあります",
            })
            continue
        }

        if (!record) {
            if (!target) {
                actions.push({ kind: "create", sourceId: source.id, row: source, hash })
            } else if (contentHash(target) === hash) {
                actions.push({ kind: "link", sourceId: source.id, hash })
            } else {
                actions.push({
                    kind: "conflict",
                    sourceId: source.id,
                    reason: "移行先に同じ id の行があり、内容が違います（取り込み記録なし）",
                })
            }
            continue
        }

        const sourceChanged = hash !== record.contentHash
        if (!target) {
            actions.push(
                sourceChanged
                    ? {
                          kind: "conflict",
                          sourceId: source.id,
                          reason: "移行後に移行先で削除された行が、旧アプリで変更されています",
                      }
                    : { kind: "keepTarget", sourceId: source.id, reason: "移行後に移行先で削除されています" }
            )
            continue
        }
        const targetHash = contentHash(target)
        const targetChanged = targetHash !== record.contentHash
        if (!sourceChanged && !targetChanged) {
            actions.push({ kind: "unchanged", sourceId: source.id })
        } else if (sourceChanged && !targetChanged) {
            actions.push({ kind: "update", sourceId: source.id, row: source, hash })
        } else if (!sourceChanged && targetChanged) {
            actions.push({ kind: "keepTarget", sourceId: source.id, reason: "移行後に移行先で変更されています" })
        } else if (targetHash === hash) {
            actions.push({ kind: "link", sourceId: source.id, hash })
        } else {
            actions.push({
                kind: "conflict",
                sourceId: source.id,
                reason: "移行後に旧アプリと移行先の両方で変更されています",
            })
        }
    }

    // 旧アプリで物理削除された行（取り込み記録はあるが、移行元にもう無い）
    for (const record of records) {
        if (sourceIds.has(record.sourceId)) continue
        const target = targetById.get(record.targetId)
        if (!target) {
            actions.push({ kind: "forgetRecord", sourceId: record.sourceId })
        } else if (contentHash(target) === record.contentHash) {
            actions.push({ kind: "delete", sourceId: record.sourceId, targetId: record.targetId })
        } else {
            actions.push({
                kind: "conflict",
                sourceId: record.sourceId,
                reason: "旧アプリで削除された行が、移行後に移行先で変更されています",
            })
        }
    }

    const resolvedActions = spec.naturalKey.length > 0 ? checkNaturalKeys(spec, actions, targetRows, records) : actions

    const touchedTargetIds = new Set([
        ...records.map((record) => record.targetId),
        ...resolvedActions.flatMap((action) => (action.kind === "link" ? [action.sourceId] : [])),
    ])
    const targetOnlyCount = targetRows.filter((row) => !touchedTargetIds.has(row.id) && !sourceIds.has(row.id)).length

    return { spec, actions: resolvedActions, targetOnlyCount }
}

/**
 * 計画どおりに書いたあとの一意キー（`@@unique([userId, 支給日])` など）の重なりを調べる。
 * 論理削除した行もキーを持ち続けるため、削除済みの行とも衝突する。
 */
function checkNaturalKeys(
    spec: ModelSpec,
    actions: PlannedAction[],
    targetRows: NormalizedRow[],
    records: ImportRecord[]
): PlannedAction[] {
    const targetIdBySourceId = new Map(records.map((record) => [record.sourceId, record.targetId]))
    const finalRowByTargetId = new Map(targetRows.map((row) => [row.id, row]))
    for (const action of actions) {
        if (action.kind === "delete") finalRowByTargetId.delete(action.targetId)
        if (action.kind === "create" || action.kind === "update") {
            const targetId = targetIdBySourceId.get(action.sourceId) ?? action.sourceId
            finalRowByTargetId.set(targetId, action.row)
        }
    }

    const ownersByKey = new Map<string, string[]>()
    for (const [targetId, row] of finalRowByTargetId) {
        const key = naturalKeyOf(spec, row)
        if (key === null) continue
        ownersByKey.set(key, [...(ownersByKey.get(key) ?? []), targetId])
    }

    const originalTargetById = new Map(targetRows.map((row) => [row.id, row]))
    return actions.map((action) => {
        if (action.kind !== "create" && action.kind !== "update") return action
        const key = naturalKeyOf(spec, action.row)
        const targetId = targetIdBySourceId.get(action.sourceId) ?? action.sourceId
        const others = (key === null ? [] : (ownersByKey.get(key) ?? [])).filter((id) => id !== targetId)
        if (others.length === 0) return action
        const other = originalTargetById.get(others[0])
        const deleted = other?.fields.deletedAt ? "、削除済み" : ""
        return {
            kind: "conflict",
            sourceId: action.sourceId,
            reason: `同じキー（${describeKey(spec, action.row)}）の行が移行先に既にあります（id ${others[0]}${deleted}）`,
        }
    })
}

export type ReferenceWarning = {
    model: "salary" | "bonus"
    sourceId: string
    itemId: string
    reason: string
}

/**
 * 給与・賞与の `data` が指す項目 id を調べる。id は写したまま使うので張り替えはしないが、
 * どの項目のものか分からない金額（項目が無く、保存時点の写し `itemSnapshots` にも無い）を報告する。
 * 項目が後から削除されていても写しがあれば集計できる（`lib/payroll/item-snapshot.ts`）ので警告にしない。
 */
export function checkItemReferences(
    rows: { model: "salary" | "bonus"; row: NormalizedRow }[],
    itemIds: Set<string>
): ReferenceWarning[] {
    const warnings: ReferenceWarning[] = []
    for (const { model, row } of rows) {
        const { values, snapshots } = referencedItemIds(row.fields.data)
        const snapshotIds = new Set(snapshots)
        for (const itemId of values) {
            if (itemIds.has(itemId) || snapshotIds.has(itemId)) continue
            warnings.push({
                model,
                sourceId: row.id,
                itemId,
                reason: "金額が入っている項目が、項目一覧にも保存時点の写しにもありません（どの項目の金額か分からない）",
            })
        }
    }
    return warnings
}

export function countActions(actions: PlannedAction[]): Record<ActionKind, number> {
    const counts: Record<ActionKind, number> = {
        create: 0,
        update: 0,
        delete: 0,
        link: 0,
        forgetRecord: 0,
        unchanged: 0,
        keepTarget: 0,
        conflict: 0,
    }
    for (const action of actions) counts[action.kind] += 1
    return counts
}

/** 書き込みを伴う計画か（何もしない・残すだけなら false）。 */
export const writesSomething = (action: PlannedAction) =>
    action.kind === "create" ||
    action.kind === "update" ||
    action.kind === "delete" ||
    action.kind === "link" ||
    action.kind === "forgetRecord"
