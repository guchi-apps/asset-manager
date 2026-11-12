/**
 * 定期払いの区分・家計簿カテゴリをJevに聞く（Issue #1332）。DBへは書かない。
 * キー未設定・通信失敗・該当なしはいずれも null の項目になる（画面は「候補を出せませんでした」と出す）。
 */
import { prisma } from "@/lib/prisma"
import { buildCategoryChoices } from "@/lib/ledger-ai-classify"
import {
    buildLedgerCategoryQuestion,
    buildSubscriptionCategoryQuestion,
    buildSubscriptionState,
    pickLedgerCategory,
    pickSubscriptionCategory,
    type SubscriptionClassification,
    type SubscriptionSubject,
} from "@/lib/subscription-classify"
import { askChoice, typeSafeApiKey } from "@/lib/typesafe-system-one"

export async function classifySubscription(
    userId: string,
    subject: SubscriptionSubject
): Promise<SubscriptionClassification & { configured: boolean }> {
    const apiKey = await typeSafeApiKey()
    if (!apiKey) return { configured: false, category: null, ledgerCategory: null }

    const categories = await prisma.ledgerCategory.findMany({
        where: { userId },
        select: { id: true, name: true, kind: true, parentId: true, hidden: true },
    })
    const choices = buildCategoryChoices(categories, "EXPENSE")
    const state = buildSubscriptionState(subject)

    const [categoryAnswer, ledgerAnswer] = await Promise.all([
        askChoice({ feature: "subscription-classify", apiKey, state, question: buildSubscriptionCategoryQuestion() }),
        choices.length === 0
            ? Promise.resolve(null)
            : askChoice({ feature: "subscription-classify", apiKey, state, question: buildLedgerCategoryQuestion(choices) }),
    ])
    return {
        configured: true,
        category: pickSubscriptionCategory(categoryAnswer),
        ledgerCategory: pickLedgerCategory(ledgerAnswer, choices),
    }
}
