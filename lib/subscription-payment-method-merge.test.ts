import assert from "node:assert/strict"
import { test } from "node:test"
import { mergeSubscriptionPaymentMethods } from "@/lib/subscription-payment-method-merge"

type Row = { id: number; userId: string; ledgerAccountId: number | null }
type Hist = { id: number; paymentMethodId: number }

function fake(rows: Row[], hist: Hist[]) {
    return {
        rows,
        hist,
        tx: {
            subscriptionPaymentMethod: {
                async findFirst({ where }: { where: { userId: string; ledgerAccountId: number } }) {
                    const r = rows.find((x) => x.userId === where.userId && x.ledgerAccountId === where.ledgerAccountId)
                    return r ? { id: r.id } : null
                },
                async update({ where, data }: { where: { id: number }; data: { ledgerAccountId: number } }) {
                    const r = rows.find((x) => x.id === where.id)!
                    // 実DBの @@unique([userId, ledgerAccountId]) を再現する
                    if (rows.some((x) => x.id !== r.id && x.userId === r.userId && x.ledgerAccountId === data.ledgerAccountId)) {
                        throw new Error("Unique constraint failed")
                    }
                    r.ledgerAccountId = data.ledgerAccountId
                },
                async deleteMany({ where }: { where: { id: number; userId: string } }) {
                    const i = rows.findIndex((x) => x.id === where.id && x.userId === where.userId)
                    if (i >= 0) rows.splice(i, 1)
                },
            },
            subscriptionPaymentMethodHistory: {
                async updateMany({ where, data }: { where: { paymentMethodId: number }; data: { paymentMethodId: number } }) {
                    for (const h of hist) if (h.paymentMethodId === where.paymentMethodId) h.paymentMethodId = data.paymentMethodId
                },
            },
        },
    }
}

test("両口座に行がある: 履歴を結合先の行へ付け替え、結合元の行を消す", async () => {
    const f = fake(
        [
            { id: 1, userId: "u", ledgerAccountId: 10 },
            { id: 2, userId: "u", ledgerAccountId: 20 },
        ],
        [
            { id: 100, paymentMethodId: 1 },
            { id: 101, paymentMethodId: 2 },
        ]
    )
    await mergeSubscriptionPaymentMethods(f.tx, "u", 10, 20)
    assert.deepEqual(f.rows, [{ id: 2, userId: "u", ledgerAccountId: 20 }])
    assert.deepEqual(f.hist.map((h) => h.paymentMethodId), [2, 2])
})

test("結合先に行がない: 結合元の行の口座だけを更新する", async () => {
    const f = fake([{ id: 1, userId: "u", ledgerAccountId: 10 }], [{ id: 100, paymentMethodId: 1 }])
    await mergeSubscriptionPaymentMethods(f.tx, "u", 10, 20)
    assert.deepEqual(f.rows, [{ id: 1, userId: "u", ledgerAccountId: 20 }])
    assert.deepEqual(f.hist.map((h) => h.paymentMethodId), [1])
})

test("結合元に行がない: 何もしない。他ユーザーの行は触らない", async () => {
    const f = fake([{ id: 2, userId: "u", ledgerAccountId: 20 }, { id: 3, userId: "other", ledgerAccountId: 10 }], [])
    await mergeSubscriptionPaymentMethods(f.tx, "u", 10, 20)
    assert.equal(f.rows.length, 2)
    assert.equal(f.rows[1].ledgerAccountId, 10)
})
