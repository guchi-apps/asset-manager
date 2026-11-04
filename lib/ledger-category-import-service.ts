/**
 * カテゴリ体系と対応表の一括読み込み（Issue #833）。下見 → 反映。
 *
 * 形と突き合わせの決まりは `lib/ledger-category-import.ts`。反映したあと、対応表を取り込み済みの品目へ
 * 当て直す（`applySourceMappings`。手で分類した品目は変えない）。
 */
import { prisma } from "@/lib/prisma"
import {
    pairLabel,
    parseCategoryImport,
    planCategoryImport,
    type CategoryImportPlan,
    type CategoryRef,
    type ParsedCategoryImport,
} from "@/lib/ledger-category-import"
import { applySourceMappings } from "@/lib/ledger-sources/mapping-service"
import { resolveCategoryMapping } from "@/lib/ledger-sources/mapping"
import zaimPreset from "@/lib/ledger-category-presets/zaim.json"

/** 画面の「おすすめの体系」。Zaimの1年分の分類から作った体系（#833 の本文） */
export function presetCategoryImportText(): string {
    return JSON.stringify(zaimPreset)
}

export interface CategoryImportPreview {
    errors: string[]
    /** 作るカテゴリの名前（「食費/食料品」） */
    creates: string[]
    existingCount: number
    mappings: { source: string; target: string; status: "new" | "changed" | "same"; previous: string | null }[]
    untouchedMappings: number
    /** 未分類の品目のうち、反映すると分類される見込みの件数 */
    classifiableLines: number
}

async function loadPlan(userId: string, parsed: ParsedCategoryImport): Promise<CategoryImportPlan> {
    const [categories, mappings] = await Promise.all([
        prisma.ledgerCategory.findMany({ where: { userId }, select: { id: true, name: true, kind: true, parentId: true } }),
        prisma.ledgerSourceCategoryMapping.findMany({
            where: { userId, provider: parsed.provider },
            select: { externalCategory: true, externalGenre: true, categoryId: true },
        }),
    ])
    return planCategoryImport(parsed, categories, mappings)
}

export async function previewCategoryImport(userId: string, text: string): Promise<CategoryImportPreview> {
    const parsed = parseCategoryImport(text)
    if (!parsed.ok) {
        return { errors: parsed.errors, creates: [], existingCount: 0, mappings: [], untouchedMappings: 0, classifiableLines: 0 }
    }
    const plan = await loadPlan(userId, parsed.value)

    // 反映後の対応表（既存の対応をファイルの対応で上書きしたもの）で、未分類の品目がいくつ分類されるかを数える。
    // 対応先が支出か収入かの食い違いは反映時に落ちるので、ここでは数えすぎることがある（目安）
    const existing = await prisma.ledgerSourceCategoryMapping.findMany({
        where: { userId, provider: parsed.value.provider },
        select: { externalCategory: true, externalGenre: true },
    })
    const merged = new Map(existing.map((m) => [`${m.externalCategory}\u0000${m.externalGenre}`, { ...m, categoryId: 1 }]))
    for (const m of plan.mappings) {
        merged.set(`${m.pair.category}\u0000${m.pair.genre}`, { externalCategory: m.pair.category, externalGenre: m.pair.genre, categoryId: 1 })
    }
    const rows = [...merged.values()]
    const groups = await prisma.ledgerLine.groupBy({
        by: ["sourceCategoryName", "sourceGenreName"],
        where: { entry: { userId, sourceProvider: parsed.value.provider }, sourceCategoryName: { not: null }, classifiedBy: null },
        _count: { _all: true },
    })
    const classifiableLines = groups
        .filter((g) => resolveCategoryMapping(rows, g.sourceCategoryName, g.sourceGenreName) != null)
        .reduce((sum, g) => sum + g._count._all, 0)

    return {
        errors: [],
        creates: plan.creates.map((c) => c.label),
        existingCount: plan.existingCount,
        mappings: plan.mappings.map((m) => ({ source: pairLabel(m.pair), target: m.targetLabel, status: m.status, previous: m.previousLabel })),
        untouchedMappings: plan.untouchedMappings,
        classifiableLines,
    }
}

export interface CategoryImportResult {
    createdCategories: number
    writtenMappings: number
    classifiedLines: number
}

export async function applyCategoryImport(userId: string, text: string): Promise<CategoryImportResult> {
    const parsed = parseCategoryImport(text)
    if (!parsed.ok) throw new Error(parsed.errors.slice(0, 3).join(" / "))
    const { provider } = parsed.value

    const written = await prisma.$transaction(async (tx) => {
        // 下見のあとに変わっていても正しく反映できるよう、トランザクションの中で計画し直す
        const [categories, mappings] = await Promise.all([
            tx.ledgerCategory.findMany({ where: { userId }, select: { id: true, name: true, kind: true, parentId: true, order: true } }),
            tx.ledgerSourceCategoryMapping.findMany({
                where: { userId, provider },
                select: { externalCategory: true, externalGenre: true, categoryId: true },
            }),
        ])
        const plan = planCategoryImport(parsed.value, categories, mappings)

        // 兄弟の末尾へ並べる
        const nextOrder = new Map<string, number>()
        const orderKey = (parentId: number | null) => String(parentId)
        for (const c of categories) {
            const key = orderKey(c.parentId)
            nextOrder.set(key, Math.max(nextOrder.get(key) ?? 0, c.order + 1))
        }
        const createdIds: number[] = []
        const resolve = (ref: CategoryRef): number => (ref.id !== undefined ? ref.id : createdIds[ref.newIndex])
        for (const create of plan.creates) {
            const parentId = create.parent ? resolve(create.parent) : null
            const key = orderKey(parentId)
            const order = nextOrder.get(key) ?? 0
            nextOrder.set(key, order + 1)
            const row = await tx.ledgerCategory.create({
                data: { userId, name: create.name, kind: create.kind, parentId, order },
                select: { id: true },
            })
            createdIds.push(row.id)
        }

        let writtenMappings = 0
        for (const m of plan.mappings) {
            if (m.status === "same") continue
            const categoryId = resolve(m.target)
            await tx.ledgerSourceCategoryMapping.upsert({
                where: {
                    userId_provider_externalCategory_externalGenre: {
                        userId,
                        provider,
                        externalCategory: m.pair.category,
                        externalGenre: m.pair.genre,
                    },
                },
                create: { userId, provider, externalCategory: m.pair.category, externalGenre: m.pair.genre, categoryId },
                update: { categoryId },
            })
            writtenMappings += 1
        }
        return { createdCategories: createdIds.length, writtenMappings }
    })

    const applied = await applySourceMappings(userId, provider)
    return { ...written, classifiedLines: applied.lines }
}
