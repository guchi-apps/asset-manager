/**
 * 家計簿のカテゴリ体系と、取り込み元の分類名との対応表を、ファイルから一括で読み込む（Issue #833）。
 * DBに触らない純粋な関数だけを置く。読み書きは `lib/ledger-category-import-service.ts`。
 *
 * ファイルの形（JSON）:
 * ```json
 * {
 *   "provider": "zaim",
 *   "categories": [
 *     { "name": "食費", "kind": "EXPENSE", "children": [
 *       { "name": "食料品", "from": ["食費/食料品", "食費/調理食品"] },
 *       { "name": "外食", "from": ["食費/外食"] }
 *     ] }
 *   ]
 * }
 * ```
 * - `from` は取り込み元の「カテゴリ/内訳」。内訳を問わない対応は「カテゴリ」だけを書く
 * - 大分類にも `from` を書ける（中分類を持たない大分類など）
 * - `"work": true` で会社関係にする（分析の「会社関係を除く」で外す。#835）。既にあるカテゴリにも付ける（外しはしない）
 * - 既にあるカテゴリは名前（大分類は名前と支出・収入、中分類は親と名前）で突き合わせ、作り直さない
 * - ファイルに書いていない既存のカテゴリ・対応は消さない
 *
 * この対応表は過去のCSV移行（#820）でだけ分類の根拠にする。継続取り込みでZaimの分類を使わない方針は #834。
 */
import { normalizeExternalName } from "@/lib/ledger-sources/mapping"

const NAME_MAX = 191

export type CategoryKind = "EXPENSE" | "INCOME"

export interface ImportSourcePair {
    category: string
    /** 内訳を問わない対応は空文字 */
    genre: string
}

export interface ImportCategoryNode {
    name: string
    kind: CategoryKind
    from: ImportSourcePair[]
    workRelated: boolean
    children: { name: string; from: ImportSourcePair[]; workRelated: boolean }[]
}

export interface ParsedCategoryImport {
    provider: string
    categories: ImportCategoryNode[]
}

export type ParseImportResult = { ok: true; value: ParsedCategoryImport } | { ok: false; errors: string[] }

function name(value: unknown): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
}

/** 「カテゴリ/内訳」を読む。最初の「/」で分け、内訳が無い・「-」なら内訳を問わない対応にする */
export function parseSourcePair(value: unknown): ImportSourcePair | null {
    if (typeof value !== "string") return null
    const index = value.indexOf("/")
    const category = normalizeExternalName(index < 0 ? value : value.slice(0, index))
    if (!category) return null
    const genre = index < 0 ? null : normalizeExternalName(value.slice(index + 1))
    return { category, genre: genre ?? "" }
}

export function pairKey(pair: ImportSourcePair): string {
    return `${pair.category}\u0000${pair.genre}`
}

export function pairLabel(pair: ImportSourcePair): string {
    return pair.genre ? `${pair.category}/${pair.genre}` : pair.category
}

/** ファイルの中身（JSONの文字列）を検証して読む。誤りはまとめて返す */
export function parseCategoryImport(text: string): ParseImportResult {
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        return { ok: false, errors: ["JSONとして読めません"] }
    }
    const body = (raw ?? {}) as Record<string, unknown>
    const errors: string[] = []
    const provider = name(body.provider) ?? "zaim"
    if (provider !== "zaim") errors.push(`取り込み元「${provider}」には対応していません（zaim だけ）`)
    if (!Array.isArray(body.categories) || body.categories.length === 0) {
        return { ok: false, errors: [...errors, "categories（カテゴリの一覧）がありません"] }
    }

    const seenPairs = new Map<string, string>()
    const readFrom = (value: unknown, owner: string): ImportSourcePair[] => {
        if (value === undefined) return []
        if (!Array.isArray(value)) {
            errors.push(`${owner}: from は「カテゴリ/内訳」の一覧で書いてください`)
            return []
        }
        const pairs: ImportSourcePair[] = []
        for (const item of value) {
            const pair = parseSourcePair(item)
            if (!pair) {
                errors.push(`${owner}: 「${String(item)}」を取り込み元の分類として読めません`)
                continue
            }
            const key = pairKey(pair)
            const other = seenPairs.get(key)
            if (other) {
                errors.push(`「${pairLabel(pair)}」が ${other} と ${owner} の両方にあります`)
                continue
            }
            seenPairs.set(key, owner)
            pairs.push(pair)
        }
        return pairs
    }

    const categories: ImportCategoryNode[] = []
    const topNames = new Set<string>()
    for (const [i, item] of (body.categories as unknown[]).entries()) {
        const node = (item ?? {}) as Record<string, unknown>
        const topName = name(node.name)
        if (!topName) {
            errors.push(`${i + 1}番目の大分類に名前がありません`)
            continue
        }
        if (topName.length > NAME_MAX) errors.push(`「${topName.slice(0, 20)}…」の名前が長すぎます`)
        if (node.kind !== "EXPENSE" && node.kind !== "INCOME") {
            errors.push(`${topName}: kind は EXPENSE（支出）か INCOME（収入）で書いてください`)
            continue
        }
        const topKey = `${node.kind}\u0000${topName}`
        if (topNames.has(topKey)) {
            errors.push(`大分類「${topName}」が2回あります`)
            continue
        }
        topNames.add(topKey)
        const children: ImportCategoryNode["children"] = []
        const childNames = new Set<string>()
        if (node.children !== undefined && !Array.isArray(node.children)) {
            errors.push(`${topName}: children は中分類の一覧で書いてください`)
        }
        for (const [j, childItem] of (Array.isArray(node.children) ? node.children : []).entries()) {
            const child = (childItem ?? {}) as Record<string, unknown>
            const childName = name(child.name)
            if (!childName) {
                errors.push(`${topName}: ${j + 1}番目の中分類に名前がありません`)
                continue
            }
            if (childName.length > NAME_MAX) errors.push(`「${childName.slice(0, 20)}…」の名前が長すぎます`)
            if (child.children !== undefined) errors.push(`${topName}/${childName}: 中分類の下にはカテゴリを作れません`)
            if (childNames.has(childName)) {
                errors.push(`${topName}: 中分類「${childName}」が2回あります`)
                continue
            }
            childNames.add(childName)
            children.push({ name: childName, from: readFrom(child.from, `${topName}/${childName}`), workRelated: child.work === true })
        }
        categories.push({ name: topName, kind: node.kind, from: readFrom(node.from, topName), workRelated: node.work === true, children })
    }
    return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { provider, categories } }
}

export interface ExistingCategory {
    id: number
    name: string
    kind: CategoryKind
    parentId: number | null
    workRelated?: boolean
}

export interface ExistingMapping {
    externalCategory: string
    externalGenre: string
    categoryId: number
}

/** 計画の中でカテゴリを指す。既にあれば id、作るものは `newIndex`（`creates` の添字） */
export type CategoryRef = { id: number; newIndex?: undefined } | { id?: undefined; newIndex: number }

export interface PlannedCreate {
    name: string
    kind: CategoryKind
    /** 大分類なら null。親も作るなら親の `newIndex` */
    parent: CategoryRef | null
    /** 画面に出す名前（「食費/食料品」） */
    label: string
    workRelated: boolean
}

export interface PlannedMapping {
    pair: ImportSourcePair
    target: CategoryRef
    targetLabel: string
    status: "new" | "changed" | "same"
    /** 変わるとき、今の対応先の名前 */
    previousLabel: string | null
}

export interface CategoryImportPlan {
    creates: PlannedCreate[]
    /** 既にあって作らないカテゴリの数 */
    existingCount: number
    /** 既にあるカテゴリのうち、会社関係にするもの（#835） */
    workUpdates: { id: number; label: string }[]
    mappings: PlannedMapping[]
    /** ファイルに書いていない既存の対応（消さずに残す） */
    untouchedMappings: number
}

/** 既にあるカテゴリ・対応と突き合わせて、作るもの・書くものを決める */
export function planCategoryImport(
    parsed: ParsedCategoryImport,
    existing: readonly ExistingCategory[],
    existingMappings: readonly ExistingMapping[]
): CategoryImportPlan {
    const creates: PlannedCreate[] = []
    const mappings: PlannedMapping[] = []
    const workUpdates: CategoryImportPlan["workUpdates"] = []
    let existingCount = 0
    const labelById = new Map<number, string>()
    for (const c of existing) {
        const parent = c.parentId != null ? existing.find((p) => p.id === c.parentId) : undefined
        labelById.set(c.id, parent ? `${parent.name}/${c.name}` : c.name)
    }
    const mappingByPair = new Map(existingMappings.map((m) => [`${m.externalCategory}\u0000${m.externalGenre}`, m]))
    const filePairs = new Set<string>()

    const addMappings = (pairs: ImportSourcePair[], target: CategoryRef, targetLabel: string) => {
        for (const pair of pairs) {
            const key = pairKey(pair)
            filePairs.add(key)
            const current = mappingByPair.get(key)
            let status: PlannedMapping["status"] = "new"
            if (current) status = target.id !== undefined && current.categoryId === target.id ? "same" : "changed"
            mappings.push({
                pair,
                target,
                targetLabel,
                status,
                previousLabel: status === "changed" && current ? (labelById.get(current.categoryId) ?? "（不明なカテゴリ）") : null,
            })
        }
    }

    for (const top of parsed.categories) {
        const found = existing.find((c) => c.parentId === null && c.kind === top.kind && c.name === top.name)
        let topRef: CategoryRef
        if (found) {
            existingCount += 1
            topRef = { id: found.id }
            if (top.workRelated && !found.workRelated) workUpdates.push({ id: found.id, label: top.name })
        } else {
            creates.push({ name: top.name, kind: top.kind, parent: null, label: top.name, workRelated: top.workRelated })
            topRef = { newIndex: creates.length - 1 }
        }
        addMappings(top.from, topRef, top.name)
        for (const child of top.children) {
            const label = `${top.name}/${child.name}`
            const foundChild = found ? existing.find((c) => c.parentId === found.id && c.name === child.name) : undefined
            let childRef: CategoryRef
            if (foundChild) {
                existingCount += 1
                childRef = { id: foundChild.id }
                if (child.workRelated && !foundChild.workRelated) workUpdates.push({ id: foundChild.id, label })
            } else {
                creates.push({ name: child.name, kind: top.kind, parent: topRef, label, workRelated: child.workRelated })
                childRef = { newIndex: creates.length - 1 }
            }
            addMappings(child.from, childRef, label)
        }
    }
    const untouchedMappings = existingMappings.filter((m) => !filePairs.has(`${m.externalCategory}\u0000${m.externalGenre}`)).length
    return { creates, existingCount, workUpdates, mappings, untouchedMappings }
}
