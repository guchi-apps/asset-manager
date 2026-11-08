/**
 * 未分類の家計簿の品目を、Jev（TypeSafe System One）でまとめて分類する（Issue #841）。判定は `lib/ledger-ai-classify.ts`。
 *
 * - 対象: 継続取り込み（Zaim）の取引の、未分類で、まだAIで試していない品目。
 *   レシートを付けた取引・品目を手直しした取引は除く。CSVから移した過去の取引はZaimの分類で分類済みなので除く
 * - 確信度が高ければ確定（`classifiedBy = AI`）。低ければ候補（`suggestedCategoryId`）として残す
 * - 1つの品目は1回だけ試す（`aiCheckedAt`）。キーが無い・通信に失敗したときは何も書かずに終わる（次回また試す）
 * - 答えの確信度は、確定・候補・該当なしのどれでも残す（`aiConfidence`。#848）
 * - 候補はまとめて採用できる。人が確かめて決めたものとして `classifiedBy = MANUAL` にする（#848）
 */
import { prisma } from "@/lib/prisma"
import { askChoice, typeSafeApiKey } from "@/lib/typesafe-system-one"
import {
    buildCategoryChoices,
    buildCategoryQuestion,
    buildLineState,
    decideAiCategory,
    groupAiSuggestions,
    pickSuggestedCategory,
    summarizeAiConfidence,
    type AiConfidenceSummary,
    type CategoryChoice,
    type AiSuggestionGroup,
} from "@/lib/ledger-ai-classify"
import { readEditedFields } from "@/lib/ledger-sources/sync-plan"

/** 1回に試す品目の上限（1日2回の取り込みのあとに動かす） */
export const AI_CLASSIFY_BATCH = 100

export interface AiClassifyResult {
    /** APIキーが無く、何もしなかった */
    skipped: boolean
    checked: number
    classified: number
    suggested: number
    /** 通信の失敗などで答えが得られなかった（次回また試す） */
    failed: number
}

/** AIで分類する対象の品目（未分類で、まだAIで試していない継続取り込みの品目）。新しい順に `limit` 件 */
async function findAiClassifyTargets(userId: string, limit: number) {
    const receiptEntryIds = (
        await prisma.receiptImport.findMany({ where: { userId, ledgerEntryId: { not: null } }, select: { ledgerEntryId: true } })
    ).map((r) => r.ledgerEntryId as number)
    return prisma.ledgerLine.findMany({
        where: {
            categoryId: null,
            aiCheckedAt: null,
            entry: {
                userId,
                origin: "SOURCE",
                kind: { in: ["EXPENSE", "INCOME"] },
                ...(receiptEntryIds.length > 0 ? { id: { notIn: receiptEntryIds } } : {}),
            },
        },
        select: {
            id: true,
            name: true,
            amount: true,
            entry: { select: { date: true, kind: true, place: true, memo: true, fromAccountId: true, toAccountId: true, editedFields: true } },
        },
        orderBy: [{ entry: { date: "desc" } }, { id: "desc" }],
        take: limit,
    })
}

export interface AiClassifyTarget {
    date: string
    place: string | null
    memo: string | null
    name: string
    amount: number
    kind: "EXPENSE" | "INCOME"
}

/** 「未分類をAIで分類」を押したときの確認用。実際に試す品目を返す（AIは呼ばない。#1122） */
export async function listAiClassifyTargets(userId: string, limit = AI_CLASSIFY_BATCH): Promise<AiClassifyTarget[]> {
    const lines = await findAiClassifyTargets(userId, limit)
    return lines
        .filter((l) => !readEditedFields(l.entry.editedFields).includes("lines"))
        .map((l) => ({
            date: l.entry.date,
            place: l.entry.place,
            memo: l.entry.memo,
            name: l.name,
            amount: l.amount,
            kind: l.entry.kind === "INCOME" ? "INCOME" : "EXPENSE",
        }))
}

export async function classifyUnclassifiedWithAi(userId: string, limit = AI_CLASSIFY_BATCH): Promise<AiClassifyResult> {
    const result: AiClassifyResult = { skipped: false, checked: 0, classified: 0, suggested: 0, failed: 0 }
    const apiKey = await typeSafeApiKey()
    if (!apiKey) return { ...result, skipped: true }

    const [lines, categories, accounts] = await Promise.all([
        findAiClassifyTargets(userId, limit),
        prisma.ledgerCategory.findMany({ where: { userId }, select: { id: true, name: true, kind: true, parentId: true, hidden: true } }),
        prisma.ledgerAccount.findMany({ where: { userId }, select: { id: true, name: true } }),
    ])
    const accountName = new Map(accounts.map((a) => [a.id, a.name]))
    const choicesByKind = {
        EXPENSE: buildCategoryChoices(categories, "EXPENSE"),
        INCOME: buildCategoryChoices(categories, "INCOME"),
    }

    for (const line of lines) {
        if (readEditedFields(line.entry.editedFields).includes("lines")) continue
        const kind = line.entry.kind === "INCOME" ? "INCOME" : "EXPENSE"
        const choices = choicesByKind[kind]
        if (choices.length === 0) continue
        const answer = await askChoice({
            feature: "ledger-category",
            apiKey,
            state: buildLineState({
                place: line.entry.place,
                name: line.name || null,
                memo: line.entry.memo,
                amount: line.amount,
                accountName: accountName.get((kind === "INCOME" ? line.entry.toAccountId : line.entry.fromAccountId) ?? -1) ?? null,
            }),
            question: buildCategoryQuestion(choices, kind),
        })
        if (!answer) {
            result.failed += 1
            continue
        }
        result.checked += 1
        const decision = decideAiCategory(answer, choices)
        const now = new Date()
        // 書く前に、手で分類された・ほかの仕組みで分類された品目は上書きしない
        if (decision.action === "classify") {
            const updated = await prisma.ledgerLine.updateMany({
                where: { id: line.id, categoryId: null },
                data: { categoryId: decision.categoryId, classifiedBy: "AI", aiCheckedAt: now, suggestedCategoryId: null, aiConfidence: answer.confidence },
            })
            if (updated.count > 0) result.classified += 1
        } else {
            await prisma.ledgerLine.updateMany({
                where: { id: line.id },
                data: { aiCheckedAt: now, suggestedCategoryId: decision.action === "suggest" ? decision.categoryId : null, aiConfidence: answer.confidence },
            })
            if (decision.action === "suggest") result.suggested += 1
        }
    }
    return result
}

export interface DraftSubject {
    kind: "EXPENSE" | "INCOME"
    place: string | null
    name: string | null
    memo: string | null
    amount: number
    accountId: number | null
}

/**
 * 取引編集で開いた未分類の品目について、その場でJevに候補を聞く（#932）。DBへは書かない。
 * キー未設定・通信失敗・該当なしはいずれも null（画面では何も出さない）
 */
export async function suggestCategoryForDraft(userId: string, subject: DraftSubject): Promise<CategoryChoice | null> {
    const apiKey = await typeSafeApiKey()
    if (!apiKey) return null
    const [categories, account] = await Promise.all([
        prisma.ledgerCategory.findMany({ where: { userId }, select: { id: true, name: true, kind: true, parentId: true, hidden: true } }),
        subject.accountId != null
            ? prisma.ledgerAccount.findFirst({ where: { id: subject.accountId, userId }, select: { name: true } })
            : Promise.resolve(null),
    ])
    const choices = buildCategoryChoices(categories, subject.kind)
    if (choices.length === 0) return null
    const answer = await askChoice({
        feature: "ledger-category",
        apiKey,
        state: buildLineState({
            place: subject.place,
            name: subject.name,
            memo: subject.memo,
            amount: subject.amount,
            accountName: account?.name ?? null,
        }),
        question: buildCategoryQuestion(choices, subject.kind),
    })
    return pickSuggestedCategory(answer, choices)
}

/** まだ分類されていない品目に付いたAIの候補。`lineIds` を渡すとその品目だけを見る */
export async function loadAiSuggestions(userId: string, lineIds?: readonly number[]): Promise<AiSuggestionGroup[]> {
    const [lines, categories] = await Promise.all([
        prisma.ledgerLine.findMany({
            where: {
                categoryId: null,
                suggestedCategoryId: { not: null },
                entry: { userId, kind: { in: ["EXPENSE", "INCOME"] } },
                ...(lineIds ? { id: { in: [...lineIds] } } : {}),
            },
            select: {
                id: true,
                name: true,
                amount: true,
                suggestedCategoryId: true,
                entry: { select: { kind: true, date: true, place: true } },
            },
            orderBy: [{ entry: { date: "desc" } }, { id: "desc" }],
        }),
        prisma.ledgerCategory.findMany({ where: { userId }, select: { id: true, name: true, kind: true, parentId: true } }),
    ])
    return groupAiSuggestions(
        lines.map((l) => ({
            id: l.id,
            kind: l.entry.kind === "INCOME" ? ("INCOME" as const) : ("EXPENSE" as const),
            date: l.entry.date,
            place: l.entry.place,
            name: l.name,
            amount: l.amount,
            suggestedCategoryId: l.suggestedCategoryId as number,
        })),
        categories
    )
}

/**
 * 選んだ品目の候補を採用する（#848）。画面に見せた品目だけを受け取り、取り込みなどで増えた候補を黙って含めない。
 * 手で決めたものにするので、同じお店の分類の引き継ぎ（`loadPlaceHistory`）が効くようになる
 */
export async function adoptAiSuggestions(userId: string, lineIds: readonly number[]): Promise<{ adopted: number }> {
    if (lineIds.length === 0) return { adopted: 0 }
    const groups = await loadAiSuggestions(userId, lineIds)
    const results = await prisma.$transaction(
        groups.map((group) =>
            prisma.ledgerLine.updateMany({
                // 読んだあとに手で分類された品目は上書きしない
                where: { id: { in: group.lines.map((l) => l.id) }, categoryId: null, suggestedCategoryId: group.categoryId },
                data: { categoryId: group.categoryId, classifiedBy: "MANUAL", suggestedCategoryId: null },
            })
        )
    )
    return { adopted: results.reduce((sum, r) => sum + r.count, 0) }
}

/** 確信度の分布（#848）。確信度を記録していない品目は数えない */
export async function loadAiConfidenceSummary(userId: string): Promise<AiConfidenceSummary> {
    const lines = await prisma.ledgerLine.findMany({
        where: { aiConfidence: { not: null }, entry: { userId } },
        select: { aiConfidence: true, categoryId: true, suggestedCategoryId: true },
    })
    return summarizeAiConfidence(lines)
}
