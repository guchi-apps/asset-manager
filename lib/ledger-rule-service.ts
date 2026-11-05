/**
 * 分類ルールの読み書きと、取り込み済みの取引への当て直し（Issue #834）。判定は `lib/ledger-rules.ts`。
 */
import { prisma } from "@/lib/prisma"
import { classify, findRule, isTransferIn, transferToAccount, RULE_FIELDS, sortRules, type ClassificationRule, type ParsedRule, type RuleField, type RuleTarget } from "@/lib/ledger-rules"
import { loadClassificationRules, loadMappingResolver, loadPlaceHistory, readRuleTarget } from "@/lib/ledger-sources/mapping-service"
import { ZAIM_PROVIDER } from "@/lib/ledger-sources/mapping"
import { readEditedFields } from "@/lib/ledger-sources/sync-plan"
import { loadAiConfidenceSummary, loadAiSuggestions } from "@/lib/ledger-ai-classify-service"
import type { AiConfidenceSummary, AiSuggestionGroup } from "@/lib/ledger-ai-classify"

export interface RuleView {
    id: number
    field: RuleField
    pattern: string
    target: RuleTarget
    categoryId: number | null
    accountId: number | null
}

export interface UnclassifiedPlace {
    place: string
    kind: "EXPENSE" | "INCOME"
    entryCount: number
}

export interface RuleOverview {
    rules: RuleView[]
    /** 未分類の品目を持つ取引が多いお店（ルールにする候補） */
    unclassifiedPlaces: UnclassifiedPlace[]
    /** まとめて採用できるAIの候補（#848） */
    aiSuggestions: AiSuggestionGroup[]
    /** AIの確信度の分布（#848） */
    aiConfidence: AiConfidenceSummary
}

export async function loadRuleOverview(userId: string): Promise<RuleOverview> {
    const [rows, groups, aiSuggestions, aiConfidence] = await Promise.all([
        prisma.ledgerClassificationRule.findMany({ where: { userId } }),
        prisma.ledgerEntry.groupBy({
            by: ["place", "kind"],
            where: { userId, place: { not: null }, kind: { in: ["EXPENSE", "INCOME"] }, lines: { some: { categoryId: null } } },
            _count: { _all: true },
        }),
        loadAiSuggestions(userId),
        loadAiConfidenceSummary(userId),
    ])
    const rules = sortRules(rows).map((r) => ({
        id: r.id,
        field: (RULE_FIELDS as readonly string[]).includes(r.field) ? (r.field as RuleField) : "PLACE",
        pattern: r.pattern,
        target: readRuleTarget(r.target),
        categoryId: r.categoryId,
        accountId: r.accountId,
    }))
    const unclassifiedPlaces = groups
        .map((g) => ({ place: g.place as string, kind: g.kind === "INCOME" ? ("INCOME" as const) : ("EXPENSE" as const), entryCount: g._count._all }))
        .sort((a, b) => b.entryCount - a.entryCount || a.place.localeCompare(b.place, "ja"))
        .slice(0, 15)
    return { rules, unclassifiedPlaces, aiSuggestions, aiConfidence }
}

async function checkCategory(userId: string, rule: ParsedRule): Promise<void> {
    if (rule.categoryId != null) {
        const owned = await prisma.ledgerCategory.count({ where: { id: rule.categoryId, userId } })
        if (owned === 0) throw new Error("カテゴリが見つかりません")
    }
    if (rule.accountId != null) {
        const owned = await prisma.ledgerAccount.count({ where: { id: rule.accountId, userId } })
        if (owned === 0) throw new Error("口座が見つかりません")
    }
}

export async function createRule(userId: string, rule: ParsedRule): Promise<void> {
    await checkCategory(userId, rule)
    const last = await prisma.ledgerClassificationRule.findFirst({ where: { userId }, orderBy: { order: "desc" }, select: { order: true } })
    await prisma.ledgerClassificationRule.create({ data: { userId, ...rule, order: (last?.order ?? -1) + 1 } })
}

export async function updateRule(userId: string, id: number, rule: ParsedRule): Promise<void> {
    await checkCategory(userId, rule)
    const updated = await prisma.ledgerClassificationRule.updateMany({ where: { id, userId }, data: rule })
    if (updated.count === 0) throw new Error("ルールが見つかりません")
}

export async function deleteRule(userId: string, id: number): Promise<void> {
    await prisma.ledgerClassificationRule.deleteMany({ where: { id, userId } })
}

export async function moveRule(userId: string, id: number, direction: "up" | "down"): Promise<void> {
    const rules = sortRules(await prisma.ledgerClassificationRule.findMany({ where: { userId }, select: { id: true, order: true } }))
    const index = rules.findIndex((r) => r.id === id)
    const swapIndex = direction === "up" ? index - 1 : index + 1
    if (index < 0 || swapIndex < 0 || swapIndex >= rules.length) return
    const reordered = [...rules]
    ;[reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]]
    await prisma.$transaction(reordered.map((r, order) => prisma.ledgerClassificationRule.update({ where: { id: r.id }, data: { order } })))
}

export interface ApplyRulesResult {
    /** カテゴリが変わった品目 */
    lines: number
    /** 振替の受け側として消した取引 */
    removed: number
    /** 振替の受け側だが手直し済みのため、消さずに集計から外した取引 */
    excluded: number
    /** 振替にした支出（#822） */
    transferred: number
}

/**
 * ルールを、取り込み済み（継続取り込み・CSV）の取引へ当て直す。
 * - カテゴリ: 手で分類した品目（`MANUAL`）と、品目を手直しした取引・レシートを付けた取引は変えない。
 *   AI（#841）で分類した品目は、ルールに当たったときだけ付け直す。
 *   ルールに当たればルールのカテゴリ。当たらなければ、継続取り込みの取引は同じお店の手での分類、
 *   CSVの取引は Zaim の分類と対応表で決め直す（ルールを消したときに元へ戻る）
 * - 振替の受け側: 手直ししていない取引は消す（継続取り込みの取引は明細の記録を「取引なし」に戻す）。
 *   手直しした取引は消さずに集計から外す
 * - 振替にする（#822）: 種別・口座・品目を手直ししていない支出（レシートを付けた取引を除く）を、入金先の口座への
 *   振替にする。振替にした取引は、ルールを消しても支出へは戻さない（明細の画面で直す）
 */
export async function applyClassificationRules(userId: string): Promise<ApplyRulesResult> {
    const [rules, history, resolver] = await Promise.all([
        loadClassificationRules(userId),
        loadPlaceHistory(userId),
        loadMappingResolver(userId, ZAIM_PROVIDER, "csv"),
    ])

    const entries = await prisma.ledgerEntry.findMany({
        where: { userId, origin: { in: ["SOURCE", "CSV"] }, kind: { in: ["EXPENSE", "INCOME"] } },
        select: {
            id: true,
            kind: true,
            place: true,
            memo: true,
            origin: true,
            editedFields: true,
            excludeFromTotals: true,
            lines: {
                select: { id: true, name: true, categoryId: true, classifiedBy: true, sourceCategoryName: true, sourceGenreName: true },
                orderBy: { order: "asc" },
            },
        },
    })

    // レシートで品目を置き換えた取引は、レシートの品目と分類が正（#814）。カテゴリは触らない
    const receiptEntryIds = new Set(
        (
            await prisma.receiptImport.findMany({ where: { userId, ledgerEntryId: { not: null } }, select: { ledgerEntryId: true } })
        ).map((r) => r.ledgerEntryId as number)
    )

    const removable: number[] = []
    const excludable: number[] = []
    const transfers: { id: number; toAccountId: number }[] = []
    const updates = new Map<string, number[]>()
    for (const entry of entries) {
        const kind = entry.kind === "INCOME" ? "INCOME" : "EXPENSE"
        const edited = readEditedFields(entry.editedFields)
        if (kind === "INCOME" && isTransferIn(rules, { kind, place: entry.place, memo: entry.memo, name: entry.lines[0]?.name ?? null })) {
            if (edited.length === 0) removable.push(entry.id)
            else if (!entry.excludeFromTotals) excludable.push(entry.id)
            continue
        }
        if (edited.includes("lines") || receiptEntryIds.has(entry.id)) continue
        if (kind === "EXPENSE" && !edited.includes("kind") && !edited.includes("accounts")) {
            const toAccountId = transferToAccount(rules, { kind, place: entry.place, memo: entry.memo, name: entry.lines[0]?.name ?? null })
            if (toAccountId != null) {
                transfers.push({ id: entry.id, toAccountId })
                continue
            }
        }
        const context = { rules, history, sourceCategory: entry.origin === "CSV" ? resolver.category : null }
        for (const line of entry.lines) {
            if (line.classifiedBy === "MANUAL") continue
            const next = classify(context, {
                kind,
                place: entry.place,
                memo: entry.memo,
                name: line.name,
                category: line.sourceCategoryName,
                genre: line.sourceGenreName,
                singleLine: entry.lines.length === 1,
            })
            // AI（Jev。#841）で分類した品目は、ルールに当たったときだけ付け直す（当たらなければAIの分類を残す）
            if (line.classifiedBy === "AI" && next.classifiedBy !== "RULE") continue
            if (next.categoryId === line.categoryId && next.classifiedBy === line.classifiedBy) continue
            const key = `${next.categoryId ?? "null"}:${next.classifiedBy ?? "null"}`
            updates.set(key, [...(updates.get(key) ?? []), line.id])
        }
    }

    let lines = 0
    for (const [key, ids] of updates) {
        const [rawCategory, rawBy] = key.split(":")
        const categoryId = rawCategory === "null" ? null : Number(rawCategory)
        const classifiedBy = rawBy === "null" ? null : (rawBy as "RULE" | "HISTORY" | "SOURCE")
        const result = await prisma.ledgerLine.updateMany({ where: { id: { in: ids } }, data: { categoryId, classifiedBy } })
        lines += result.count
    }
    if (removable.length > 0) {
        await prisma.$transaction([
            prisma.ledgerSourceRecord.updateMany({ where: { userId, entryId: { in: removable } }, data: { entryId: null } }),
            prisma.receiptImport.updateMany({ where: { userId, ledgerEntryId: { in: removable } }, data: { ledgerEntryId: null, ledgerAccountId: null } }),
            prisma.ledgerLine.deleteMany({ where: { entryId: { in: removable } } }),
            prisma.ledgerEntry.deleteMany({ where: { id: { in: removable }, userId } }),
        ])
    }
    if (excludable.length > 0) {
        await prisma.ledgerEntry.updateMany({ where: { id: { in: excludable }, userId }, data: { excludeFromTotals: true } })
    }
    for (const t of transfers) {
        await prisma.$transaction([
            prisma.ledgerLine.deleteMany({ where: { entryId: t.id } }),
            prisma.ledgerEntry.update({
                where: { id: t.id },
                data: { kind: "TRANSFER", toAccountId: t.toAccountId, sourceToName: null, excludeFromTotals: false, special: false },
            }),
        ])
    }
    return { lines, removed: removable.length, excluded: excludable.length, transferred: transfers.length }
}

export interface RulePreview {
    /** このルールに当たる取り込み済みの取引の数（今あるルールのほうが先に当たるものは除く） */
    matches: number
    /** 今あるルールが先に当たるため、このルールが効かない取引の数 */
    shadowed: number
    samples: { date: string; place: string | null; memo: string | null; amount: number; kind: "EXPENSE" | "INCOME" }[]
}

/**
 * 保存する前の下見（#822）。新しいルールは末尾に足すので、今あるルールの後ろに置いたときに当たる取引を数える。
 * 対象は当て直しと同じく、取り込み済み（継続取り込み・CSV）の支出・収入
 */
export async function previewRule(userId: string, rule: ParsedRule): Promise<RulePreview> {
    await checkCategory(userId, rule)
    const rules = await loadClassificationRules(userId)
    const categoryKind =
        rule.categoryId != null
            ? ((await prisma.ledgerCategory.findFirst({ where: { id: rule.categoryId, userId }, select: { kind: true } }))?.kind ?? null)
            : null
    const probe: ClassificationRule = { id: Number.MAX_SAFE_INTEGER, ...rule, categoryKind, order: Number.MAX_SAFE_INTEGER }
    const entries = await prisma.ledgerEntry.findMany({
        where: { userId, origin: { in: ["SOURCE", "CSV"] }, kind: { in: ["EXPENSE", "INCOME"] } },
        select: { date: true, kind: true, place: true, memo: true, amount: true, lines: { select: { name: true }, orderBy: { order: "asc" }, take: 1 } },
        orderBy: [{ date: "desc" }, { id: "desc" }],
    })
    const result: RulePreview = { matches: 0, shadowed: 0, samples: [] }
    for (const e of entries) {
        const kind = e.kind === "INCOME" ? ("INCOME" as const) : ("EXPENSE" as const)
        const subject = { kind, place: e.place, memo: e.memo, name: e.lines[0]?.name ?? null }
        if (findRule([probe], subject) == null) continue
        if (findRule([...rules, probe], subject)?.id !== probe.id) {
            result.shadowed += 1
            continue
        }
        result.matches += 1
        if (result.samples.length < 5) result.samples.push({ date: e.date, place: e.place, memo: e.memo, amount: e.amount, kind })
    }
    return result
}
