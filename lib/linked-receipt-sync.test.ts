import { test } from "node:test"
import assert from "node:assert/strict"
import { describeLinkedReceiptSync, type LinkedReceiptSyncResult } from "./linked-receipt-sync"

function result(overrides: {
    imported?: Partial<LinkedReceiptSyncResult["imported"]>
    registered?: Partial<LinkedReceiptSyncResult["registered"]>
}): LinkedReceiptSyncResult {
    return {
        imported: {
            created: 0,
            updated: 0,
            items: 0,
            autoConfirmed: 0,
            aiUsed: false,
            fromWeb: 0,
            webSourceReason: null,
            createdIds: [],
            ...overrides.imported,
        },
        registered: { created: 0, attached: 0, choose: 0, heldStatements: 0, failed: [], ...overrides.registered },
    }
}

test("新しい明細が無ければ、その旨だけを返す", () => {
    assert.equal(describeLinkedReceiptSync(result({})), "スマートレシート・Amazon: 新しい明細はありません")
})

test("取り込み・登録・照合待ちの件数を、0件のものを省いて並べる", () => {
    const text = describeLinkedReceiptSync(
        result({
            imported: { created: 3, createdIds: [1, 2, 3], autoConfirmed: 2 },
            registered: { created: 1, attached: 1, heldStatements: 1 },
        })
    )
    assert.equal(
        text,
        "スマートレシート・Amazon: 新しく 3件・家計簿へ反映待ちで登録 1件・家計簿の取引に付けた 1件・カード明細を照合待ちに 1件"
    )
})

test("付け先の候補が複数・登録の失敗も件数で出す", () => {
    const text = describeLinkedReceiptSync(
        result({ imported: { updated: 1 }, registered: { choose: 1, failed: [{ id: 9, error: "x" }] } })
    )
    assert.equal(text, "スマートレシート・Amazon: 明細を追加 1件・付け先の候補が複数 1件・登録に失敗 1件")
})
