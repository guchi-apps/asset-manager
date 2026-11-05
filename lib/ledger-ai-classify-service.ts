/**
 * 未分類の家計簿の品目を、Jev（TypeSafe System One）でまとめて分類する（Issue #841）。判定は `lib/ledger-ai-classify.ts`。
 *
 * - 対象: 継続取り込み（Zaim）の取引の、未分類で、まだAIで試していない品目。
 *   レシートを付けた取引・品目を手直しした取引は除く。CSVから移した過去の取引はZaimの分類で分類済みなので除く
 * - 確信度が高ければ確定（`classifiedBy = AI`）。低ければ候補（`suggestedCategoryId`）として残す
 * - 1つの品目は1回だけ試す（`aiCheckedAt`）。キーが無い・通信に失敗したときは何も書かずに終わる（次回また試す）
 */
import { prisma } from "@/lib/prisma"
import { askChoice, typeSafeApiKey } from "@/lib/typesafe-system-one"
import {
    buildCategoryChoices,
    buildCategoryQuestion,
    buildLineState,
    decideAiCategory,
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

export async function classifyUnclassifiedWithAi(userId: string, limit = AI_CLASSIFY_BATCH): Promise<AiClassifyResult> {
    const result: AiClassifyResult = { skipped: false, checked: 0, classified: 0, suggested: 0, failed: 0 }
    const apiKey = await typeSafeApiKey()
    if (!apiKey) return { ...result, skipped: true }

    const receiptEntryIds = (
        await prisma.receiptImport.findMany({ where: { userId, ledgerEntryId: { not: null } }, select: { ledgerEntryId: true } })
    ).map((r) => r.ledgerEntryId as number)
    const [lines, categories, accounts] = await Promise.all([
        prisma.ledgerLine.findMany({
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
                entry: { select: { kind: true, place: true, memo: true, fromAccountId: true, toAccountId: true, editedFields: true } },
            },
            orderBy: [{ entry: { date: "desc" } }, { id: "desc" }],
            take: limit,
        }),
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
                data: { categoryId: decision.categoryId, classifiedBy: "AI", aiCheckedAt: now, suggestedCategoryId: null },
            })
            if (updated.count > 0) result.classified += 1
        } else {
            await prisma.ledgerLine.updateMany({
                where: { id: line.id },
                data: { aiCheckedAt: now, suggestedCategoryId: decision.action === "suggest" ? decision.categoryId : null },
            })
            if (decision.action === "suggest") result.suggested += 1
        }
    }
    return result
}
