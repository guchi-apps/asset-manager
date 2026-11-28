import assert from "node:assert/strict"
import { test } from "node:test"

import { linkReceiptToPayment } from "@/lib/ledger-refund-service"
import { prisma } from "@/lib/prisma"

/** `$transaction` を差し替えて、受け取り1件ぶんのロック・読み出し・更新だけを模す */
function stubReceipt(refundOfEntryId: number | null) {
    const receipt = { kind: "EXPENSE", amount: -500, refundOfEntryId, sourceProvider: null, editedFields: null, lines: [{ id: 21, categoryId: null }] }
    const lineWrites: unknown[] = []
    const calls: string[] = []
    const tx = {
        $queryRaw: async (sql: TemplateStringsArray) => {
            assert.match(sql.join("?"), /FOR UPDATE$/)
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
