import { prisma } from "@/lib/prisma"
import type { PaymentSample } from "@/lib/subscription-estimate"

export interface SubscriptionPaymentSample extends PaymentSample {
    /** 明細の相手先（お店）。候補の照合に使う */
    places: string[]
}

/** 定期払いごとの確定済みの支払い（支払い履歴と同じ対象）。金額が毎回変わる契約だけを渡す */
export async function loadSubscriptionPaymentSamples(
    userId: string,
    subscriptionIds: number[]
): Promise<Map<number, SubscriptionPaymentSample[]>> {
    const result = new Map<number, SubscriptionPaymentSample[]>()
    if (subscriptionIds.length === 0) return result
    const rows = await prisma.ledgerEntry.findMany({
        where: { userId, subscriptionId: { in: subscriptionIds }, kind: "EXPENSE", status: "CONFIRMED" },
        select: { subscriptionId: true, date: true, amount: true, place: true, counterparty: true },
    })
    for (const row of rows) {
        if (row.subscriptionId === null) continue
        const list = result.get(row.subscriptionId) ?? []
        list.push({
            date: row.date,
            amount: row.amount,
            places: [row.place, row.counterparty].filter((v): v is string => !!v?.trim()),
        })
        result.set(row.subscriptionId, list)
    }
    return result
}
