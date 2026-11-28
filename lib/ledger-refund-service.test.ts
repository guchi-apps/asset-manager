import assert from "node:assert/strict"
import { test } from "node:test"

import { linkReceiptToPayment, resolveRefundOfEntryIdOnUpdate } from "@/lib/ledger-refund-service"
import { prisma } from "@/lib/prisma"

/** `$transaction` を差し替えて、受け取り1件ぶんのロック・読み出し・更新だけを模す */
function stubReceipt(refundOfEntryId: number | null) {
    const receipt = { kind: "EXPENSE", amount: -500, refundOfEntryId, sourceProvider: null, editedFields: null, lines: [{ id: 21, categoryId: null }] }
    const lineWrites: unknown[] = []
    const calls: string[] = []
    const tx = {
        $queryRaw: async (sql: TemplateStringsArray, ids: { values: unknown[] }) => {
            assert.match(sql.join("?"), /ORDER BY id FOR UPDATE$/)
            assert.deepEqual(ids.values, [1, 2], "支払いと受け取りの両方を id の順にロックする（#1673）")
            calls.push("lock")
            return []
        },
        ledgerEntry: {
            findFirst: async ({ where }: { where: { id: number } }) => {
                calls.push("read")
                return where.id === 2 ? { ...receipt } : { kind: "EXPENSE", amount: 3000, lines: [{ amount: 3000, categoryId: 7 }] }
            },
            update: async ({ data }: { data: { refundOfEntryId: number } }) => void (receipt.refundOfEntryId = data.refundOfEntryId),
        },
        ledgerLine: { updateMany: async (args: unknown) => void lineWrites.push(args) },
    }
    Object.assign(prisma, { $transaction: async (fn: (t: unknown) => Promise<void>) => fn(tx) })
    return { receipt, lineWrites, calls }
}

test("未紐づけの受け取りは紐づけて、空のカテゴリを補う", async () => {
    const { receipt, lineWrites, calls } = stubReceipt(null)
    await linkReceiptToPayment("u", 1, 2)
    assert.equal(calls[0], "lock", "読み出しより先に受け取りの行をロックする")
    assert.equal(receipt.refundOfEntryId, 1)
    assert.equal(lineWrites.length, 1)
})

test("別の支払いに紐づけ済みの受け取りは上書きせず、競合エラーにする（#1671）", async () => {
    const { receipt, lineWrites } = stubReceipt(9)
    await assert.rejects(linkReceiptToPayment("u", 1, 2), /別の支払いに紐づけ済み/)
    assert.equal(receipt.refundOfEntryId, 9)
    assert.equal(lineWrites.length, 0)
})

test("同じ支払いへの二重の操作は何もせず成功する", async () => {
    const { lineWrites } = stubReceipt(1)
    await linkReceiptToPayment("u", 1, 2)
    assert.equal(lineWrites.length, 0)
})

/** 返金元の候補を1件だけ返す tx（id 5 はプラスの支出、id 6 はマイナスの支出） */
function stubSourceTx() {
    return {
        ledgerEntry: {
            findFirst: async ({ where }: { where: { id: number } }) =>
                where.id === 5 ? { kind: "EXPENSE", amount: 3000 } : where.id === 6 ? { kind: "EXPENSE", amount: -100 } : null,
        },
    } as never
}

test("編集で返金元を変えていなければ、開いたあとの紐づけを残す（#1673）", async () => {
    const input = { kind: "EXPENSE", amount: -500, refundOfEntryId: null, refundOfEntryIdLoaded: null }
    assert.equal(await resolveRefundOfEntryIdOnUpdate(stubSourceTx(), "u", 2, input, 5), 5)
})

test("残す返金元が支払いでなくなっていれば、送られた値を書く", async () => {
    const input = { kind: "EXPENSE", amount: -500, refundOfEntryId: null, refundOfEntryIdLoaded: null }
    assert.equal(await resolveRefundOfEntryIdOnUpdate(stubSourceTx(), "u", 2, input, 6), null)
})

test("編集で返金元を選び直したら、その値を検証して書く", async () => {
    const input = { kind: "EXPENSE", amount: -500, refundOfEntryId: 5, refundOfEntryIdLoaded: null }
    assert.equal(await resolveRefundOfEntryIdOnUpdate(stubSourceTx(), "u", 2, input, 9), 5)
    await assert.rejects(resolveRefundOfEntryIdOnUpdate(stubSourceTx(), "u", 2, { ...input, refundOfEntryId: 6 }, null), /返金元の取引が見つかりません/)
})
