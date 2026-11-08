/**
 * 未分類の品目から、AIに分類ルールを提案させる（Issue #1123）。判定・API呼び出しは `lib/ledger-rule-suggest.ts`。
 *
 * 対象の未分類の品目は、ルールを当て直す対象（`applyClassificationRules`）と揃える。
 * 取り込み済み（継続取り込み・CSV）の支出・収入のうち、品目を手直しした取引・レシートを付けた取引を除いたもの。
 */
import { getAnthropicApiKey } from "@/lib/anthropic-messages"
import { buildCategoryChoices } from "@/lib/ledger-ai-classify"
import { prisma } from "@/lib/prisma"
import { loadClassificationRules } from "@/lib/ledger-sources/mapping-service"
import { readEditedFields } from "@/lib/ledger-sources/sync-plan"
import {
    attachSuggestionMatches,
    groupUnclassifiedLines,
    requestRuleSuggestions,
    RuleSuggestError,
    type ExistingRule,
    type RuleSuggestion,
    type SuggestCategory,
    type UnclassifiedLine,
} from "@/lib/ledger-rule-suggest"

async function loadUnclassifiedLines(userId: string): Promise<UnclassifiedLine[]> {
    const receiptEntryIds = (
        await prisma.receiptImport.findMany({ where: { userId, ledgerEntryId: { not: null } }, select: { ledgerEntryId: true } })
    ).map((r) => r.ledgerEntryId as number)
    const lines = await prisma.ledgerLine.findMany({
        where: {
            categoryId: null,
            entry: {
                userId,
                origin: { in: ["SOURCE", "CSV"] },
                kind: { in: ["EXPENSE", "INCOME"] },
                ...(receiptEntryIds.length > 0 ? { id: { notIn: receiptEntryIds } } : {}),
            },
        },
        select: {
            name: true,
            amount: true,
            entry: { select: { kind: true, date: true, place: true, memo: true, editedFields: true } },
        },
        orderBy: [{ entry: { date: "desc" } }, { id: "desc" }],
    })
    return lines
        .filter((l) => !readEditedFields(l.entry.editedFields).includes("lines"))
        .map((l) => ({
            kind: l.entry.kind === "INCOME" ? ("INCOME" as const) : ("EXPENSE" as const),
            date: l.entry.date,
            place: l.entry.place,
            memo: l.entry.memo,
            name: l.name || null,
            amount: l.amount,
        }))
}

/** 提案の対象になる未分類の品目の数（画面の説明に出す） */
export async function countUnclassifiedLines(userId: string): Promise<number> {
    return (await loadUnclassifiedLines(userId)).length
}

export interface RuleSuggestResult {
    /** 対象にした未分類の品目の数 */
    unclassified: number
    suggestions: RuleSuggestion[]
}

/** AIにルールを提案させ、それぞれが今の未分類の品目に何件当たるかを付けて返す。保存はしない */
export async function suggestClassificationRules(userId: string): Promise<RuleSuggestResult> {
    const apiKey = getAnthropicApiKey()
    if (!apiKey) throw new RuleSuggestError("AIのAPIキー（ANTHROPIC_API_KEY）が設定されていません")

    const [lines, rules, categories, accounts] = await Promise.all([
        loadUnclassifiedLines(userId),
        loadClassificationRules(userId),
        prisma.ledgerCategory.findMany({ where: { userId }, select: { id: true, name: true, kind: true, parentId: true, hidden: true } }),
        prisma.ledgerAccount.findMany({ where: { userId, hidden: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ])
    if (lines.length === 0) return { unclassified: 0, suggestions: [] }

    const groups = groupUnclassifiedLines(lines)
    const choices: SuggestCategory[] = [
        ...buildCategoryChoices(categories, "EXPENSE").map((c) => ({ ...c, kind: "EXPENSE" as const })),
        ...buildCategoryChoices(categories, "INCOME").map((c) => ({ ...c, kind: "INCOME" as const })),
    ]
    const labelOf = (id: number | null) => {
        const category = categories.find((c) => c.id === id)
        if (!category) return "（消えたカテゴリ）"
        const parent = categories.find((c) => c.id === category.parentId)
        return parent ? `${parent.name} / ${category.name}` : category.name
    }
    const accountName = new Map(accounts.map((a) => [a.id, a.name]))
    const existing: ExistingRule[] = rules.map((r) => ({
        field: r.field,
        pattern: r.pattern,
        targetLabel:
            r.target === "TRANSFER_IN"
                ? "振替の受け側（収入にしない）"
                : r.target === "TRANSFER_TO"
                  ? `振替にする（入金先: ${accountName.get(r.accountId ?? -1) ?? "口座"}）`
                  : labelOf(r.categoryId),
    }))

    const drafts = await requestRuleSuggestions(apiKey, { groups, rules: existing, categories: choices, accounts })
    const kindById = new Map(categories.map((c) => [c.id, c.kind === "INCOME" ? ("INCOME" as const) : ("EXPENSE" as const)]))
    return {
        unclassified: lines.length,
        suggestions: attachSuggestionMatches(drafts, groups, rules, (id) => kindById.get(id) ?? null),
    }
}
