import { prisma } from "@/lib/prisma"
import { pickPaymentPlace } from "@/lib/subscription-payments"
import { addDays, todayDayKey } from "@/lib/subscription-billing"
import {
    SUGGEST_LOOKBACK_DAYS,
    suggestSubscriptions,
    suggestionKey,
    type SubscriptionSuggestion,
    type SuggestEntry,
} from "@/lib/subscription-suggest"

/**
 * 定期払いの候補（Issue #1349）の読み出しと「定期払いではない」の保存。判定は `lib/subscription-suggest.ts`。
 * 候補は保存せず、定期払いの画面を開くたびに直近の明細から計算し直す。
 */

/** 判定の対象は確定済みの支出だけ（反映待ちは日付・金額がまだ決まっていない） */
const SUGGEST_WHERE = { kind: "EXPENSE", status: "CONFIRMED" } as const

export async function loadSubscriptionSuggestions(userId: string, today = todayDayKey()): Promise<SubscriptionSuggestion[]> {
    const [rows, subscriptions, dismissals] = await Promise.all([
        prisma.ledgerEntry.findMany({
            where: { userId, ...SUGGEST_WHERE, date: { gte: addDays(today, -SUGGEST_LOOKBACK_DAYS), lte: today } },
            select: {
                id: true,
                date: true,
                amount: true,
                place: true,
                counterparty: true,
                subscriptionId: true,
                fromAccountId: true,
                fromAccount: { select: { name: true, shortName: true } },
                // お店の名前が無い明細だけ品目名を使う。先頭の数行で足りる
                lines: { orderBy: { order: "asc" }, take: 3, select: { name: true } },
            },
        }),
        prisma.subscription.findMany({ where: { userId }, select: { name: true } }),
        prisma.subscriptionSuggestionDismissal.findMany({ where: { userId }, select: { key: true } }),
    ])

    const entries: SuggestEntry[] = []
    const linkedNames: string[] = []
    for (const row of rows) {
        const name = pickPaymentPlace(row)
        if (!name) continue
        if (row.subscriptionId !== null) {
            linkedNames.push(name)
            continue
        }
        entries.push({
            id: row.id,
            date: row.date,
            amount: row.amount,
            name,
            accountId: row.fromAccountId,
            accountName: row.fromAccount ? row.fromAccount.shortName?.trim() || row.fromAccount.name : null,
        })
    }

    return suggestSubscriptions(entries, {
        today,
        subscriptionNames: subscriptions.map((s) => s.name),
        linkedNames,
        dismissedKeys: dismissals.map((d) => d.key),
    })
}

/** 「定期払いではない」。同じお店の候補を以後出さない */
export async function dismissSubscriptionSuggestion(userId: string, name: string): Promise<void> {
    const key = suggestionKey(name)
    if (!key) throw new Error("候補の名前が正しくありません")
    const display = name.trim().slice(0, 191)
    await prisma.subscriptionSuggestionDismissal.upsert({
        where: { userId_key: { userId, key } },
        create: { userId, key, name: display },
        update: { name: display, dismissedAt: new Date() },
    })
}
