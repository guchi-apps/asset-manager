import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    dismissKey,
    findReceiptDuplicates,
    isSameStore,
    receiptPairKey,
    zaimPairKey,
    type DuplicateReceiptInput,
    type DuplicateZaimInput,
} from "./receipt-duplicates"

function receipt(overrides: Partial<DuplicateReceiptInput> = {}): DuplicateReceiptInput {
    return {
        id: 1,
        source: "GMAIL",
        status: "REVIEW_REQUIRED",
        storeName: "ENEOS",
        purchasedDate: "2026-09-05",
        totalAmount: 6480,
        sourceZaimMoneyIds: [],
        ...overrides,
    }
}

function zaim(overrides: Partial<DuplicateZaimInput> = {}): DuplicateZaimInput {
    return {
        id: 10300000001,
        date: "2026-09-05",
        amount: 6480,
        place: "エネオス",
        name: "ガソリン",
        accountId: 77,
        comment: "",
        ...overrides,
    }
}

const none = new Set<string>()

describe("isSameStore", () => {
    it("末尾の「店」や空白の違いは同じ店として扱う", () => {
        assert.equal(isSameStore("イオン 西新井店", "イオン西新井"), true)
        assert.equal(isSameStore("エネオス 西新井店", "エネオス"), true)
    })

    it("片方が空なら一致としない", () => {
        assert.equal(isSameStore("", "エネオス"), false)
        assert.equal(isSameStore(null, null), false)
    })

    it("表記の違う名前は一致としない", () => {
        assert.equal(isSameStore("ENEOS", "エネオス"), false)
    })
})

describe("findReceiptDuplicates（取り込み同士）", () => {
    it("同じ日・同じ金額なら、店舗名が違っても候補にする", () => {
        const result = findReceiptDuplicates({
            receipts: [
                receipt({ id: 1 }),
                receipt({ id: 2, source: "EXTERNAL_APP", storeName: "エネオス 西新井店" }),
            ],
            zaimEntries: null,
            dismissedKeys: none,
        })
        assert.deepEqual(Object.keys(result), ["1", "2"])
        assert.equal(result[1][0].counterpart.kind, "receipt")
        assert.equal(result[1][0].sameStore, false)
        assert.equal(result[1][0].dayGap, 0)
    })

    it("日がずれるときは、店舗名も一致したものだけ候補にする", () => {
        const result = findReceiptDuplicates({
            receipts: [
                receipt({ id: 1, storeName: "ライフ 高槻城西店" }),
                receipt({ id: 2, storeName: "ライフ高槻城西", purchasedDate: "2026-09-08" }),
                receipt({ id: 3, storeName: "サンディ", purchasedDate: "2026-09-06" }),
            ],
            zaimEntries: null,
            dismissedKeys: none,
        })
        assert.deepEqual(
            result[1].map((match) => match.counterpart.key),
            ["receipt:2"]
        )
        assert.equal(result[1][0].sameStore, true)
        assert.equal(result[1][0].dayGap, 3)
        assert.equal(result[3], undefined)
    })

    it("前後3日を超える・金額が違う明細は候補にしない", () => {
        const result = findReceiptDuplicates({
            receipts: [
                receipt({ id: 1 }),
                receipt({ id: 2, purchasedDate: "2026-09-09" }),
                receipt({ id: 3, totalAmount: 6481 }),
            ],
            zaimEntries: null,
            dismissedKeys: none,
        })
        assert.deepEqual(result, {})
    })

    it("反映済みの明細は相手になるが、印は付けない", () => {
        const result = findReceiptDuplicates({
            receipts: [receipt({ id: 1 }), receipt({ id: 2, status: "REPLACED", source: "SMART_RECEIPT" })],
            zaimEntries: null,
            dismissedKeys: none,
        })
        assert.deepEqual(Object.keys(result), ["1"])
        assert.equal(result[1][0].counterpart.kind === "receipt" && result[1][0].counterpart.status, "REPLACED")
    })

    it("止まっている明細・購入日や金額の無い明細には印を付けない", () => {
        const result = findReceiptDuplicates({
            receipts: [
                receipt({ id: 1, status: "MANUAL_ACTION_REQUIRED" }),
                receipt({ id: 2, status: "FAILED" }),
                receipt({ id: 3, purchasedDate: null }),
                receipt({ id: 4, totalAmount: null }),
            ],
            zaimEntries: null,
            dismissedKeys: none,
        })
        assert.deepEqual(result, {})
    })

    it("「重複ではない」と記録した組は、どちらの側からも出さない", () => {
        const result = findReceiptDuplicates({
            receipts: [receipt({ id: 1 }), receipt({ id: 2 })],
            zaimEntries: null,
            dismissedKeys: new Set([receiptPairKey(2, 1)]),
        })
        assert.deepEqual(result, {})
    })

    it("targetIds で印を付ける明細を絞れる", () => {
        const result = findReceiptDuplicates({
            receipts: [receipt({ id: 1 }), receipt({ id: 2 })],
            zaimEntries: null,
            dismissedKeys: none,
            targetIds: new Set([2]),
        })
        assert.deepEqual(Object.keys(result), ["2"])
    })

    it("店舗も一致した候補・日の近い候補を先に並べる", () => {
        const result = findReceiptDuplicates({
            receipts: [
                receipt({ id: 1, storeName: "エネオス" }),
                receipt({ id: 2, storeName: "ENEOS" }),
                receipt({ id: 3, storeName: "エネオス西新井", purchasedDate: "2026-09-07" }),
                receipt({ id: 4, storeName: "エネオス", purchasedDate: "2026-09-06" }),
            ],
            zaimEntries: null,
            dismissedKeys: none,
        })
        assert.deepEqual(
            result[1].map((match) => match.counterpart.key),
            ["receipt:4", "receipt:3", "receipt:2"]
        )
    })
})

describe("findReceiptDuplicates（Zaim明細との照合）", () => {
    it("Zaimに手入力された同じ支払いを候補にする", () => {
        const result = findReceiptDuplicates({
            receipts: [receipt({ id: 1 })],
            zaimEntries: [zaim()],
            dismissedKeys: none,
        })
        const match = result[1][0]
        assert.equal(match.counterpart.kind, "zaim")
        assert.deepEqual(match.counterpart.kind === "zaim" && match.counterpart.moneyIds, [10300000001])
    })

    it("当アプリが登録した明細と、取り込み元のZaim明細は外す", () => {
        const result = findReceiptDuplicates({
            receipts: [
                receipt({ id: 1 }),
                receipt({
                    id: 2,
                    status: "REPLACED",
                    source: "SMART_RECEIPT",
                    totalAmount: 100,
                    sourceZaimMoneyIds: [10300000002],
                }),
            ],
            zaimEntries: [
                zaim({ id: 10300000001, comment: "Asset Manager レシート取込 #9" }),
                zaim({ id: 10300000002 }),
            ],
            dismissedKeys: none,
        })
        assert.deepEqual(result, {})
    })

    it("登録済み（反映待ち）の明細はZaim明細と照合しない", () => {
        const result = findReceiptDuplicates({
            receipts: [receipt({ id: 1, status: "SENT_TO_ZAIM" })],
            zaimEntries: [zaim()],
            dismissedKeys: none,
        })
        assert.deepEqual(result, {})
    })

    it("同じ日・同じ口座・同じ店の明細を合算した金額でも候補にする", () => {
        const result = findReceiptDuplicates({
            receipts: [receipt({ id: 1, storeName: "サンディ", totalAmount: 4855 })],
            zaimEntries: [
                zaim({ id: 11, place: "サンディ", amount: 4000 }),
                zaim({ id: 12, place: "サンディ", amount: 855 }),
                zaim({ id: 13, place: "サンディ", amount: 855, accountId: 88 }),
            ],
            dismissedKeys: none,
        })
        assert.equal(result[1].length, 1)
        const counterpart = result[1][0].counterpart
        assert.deepEqual(counterpart.kind === "zaim" && counterpart.moneyIds, [11, 12])
    })

    it("「重複ではない」と記録したZaim明細は出さない", () => {
        const counterpart = {
            kind: "zaim" as const,
            key: "zaim:10300000001",
            moneyIds: [10300000001],
            accountId: 77,
            place: "エネオス",
            name: null,
            date: "2026-09-05",
            amount: 6480,
        }
        assert.equal(dismissKey(1, counterpart), zaimPairKey(1, [10300000001]))
        const result = findReceiptDuplicates({
            receipts: [receipt({ id: 1 })],
            zaimEntries: [zaim()],
            dismissedKeys: new Set([dismissKey(1, counterpart)]),
        })
        assert.deepEqual(result, {})
    })
})
