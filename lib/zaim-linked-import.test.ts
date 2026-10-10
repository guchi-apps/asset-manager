import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    buildLinkedReceiptDrafts,
    buildSourceKey,
    isImportableLinkedEntry,
    type BuildLinkedDraftsOptions,
    type LinkedMoneyEntry,
} from "./zaim-linked-import"

const SMART_RECEIPT_ACCOUNT = 21351678
const AMAZON_ACCOUNT = 14255306

const options: BuildLinkedDraftsOptions = {
    sourceByAccountId: new Map([
        [SMART_RECEIPT_ACCOUNT, "SMART_RECEIPT" as const],
        [AMAZON_ACCOUNT, "AMAZON" as const],
    ]),
    accountNameById: new Map([
        [SMART_RECEIPT_ACCOUNT, "スマートレシート"],
        [AMAZON_ACCOUNT, "Amazon.co.jp"],
    ]),
}

function entry(overrides: Partial<LinkedMoneyEntry> & { id: number }): LinkedMoneyEntry {
    return {
        date: "2026-08-20",
        amount: 100,
        name: "商品",
        place: "イオン西新井店",
        fromAccountId: SMART_RECEIPT_ACCOUNT,
        categoryId: 101,
        genreId: 29784033,
        active: true,
        ...overrides,
    }
}

describe("isImportableLinkedEntry", () => {
    it("ignores entries from accounts that are not linked sources", () => {
        assert.equal(
            isImportableLinkedEntry(entry({ id: 1, fromAccountId: 18774268 }), options),
            false
        )
    })

    it("ignores entries already excluded from totals in Zaim", () => {
        assert.equal(isImportableLinkedEntry(entry({ id: 1, active: false }), options), false)
    })

    it("ignores entries already imported", () => {
        assert.equal(
            isImportableLinkedEntry(entry({ id: 7 }), {
                ...options,
                importedMoneyIds: new Set([7]),
            }),
            false
        )
    })

    it("ignores adjustment rows with no amount", () => {
        assert.equal(isImportableLinkedEntry(entry({ id: 1, amount: 0 }), options), false)
    })
})

describe("buildLinkedReceiptDrafts", () => {
    it("groups a smart receipt's item-level entries into one import", () => {
        const drafts = buildLinkedReceiptDrafts(
            [
                entry({ id: 11, name: "牛乳", amount: 218 }),
                entry({ id: 12, name: "食パン", amount: 158 }),
                entry({ id: 13, name: "たまご", amount: 268 }),
            ],
            options
        )

        assert.equal(drafts.length, 1)
        assert.equal(drafts[0].source, "SMART_RECEIPT")
        assert.equal(drafts[0].storeName, "イオン西新井店")
        assert.equal(drafts[0].purchasedAt, "2026-08-20")
        assert.equal(drafts[0].totalAmount, 644)
        assert.deepEqual(
            drafts[0].items.map((item) => item.sourceZaimMoneyId),
            [11, 12, 13]
        )
    })

    it("keeps a rolled-up entry as a single-item import", () => {
        const drafts = buildLinkedReceiptDrafts(
            [entry({ id: 21, name: null, amount: 644 })],
            options
        )

        assert.equal(drafts.length, 1)
        assert.equal(drafts[0].items.length, 1)
        // 品目名が空でも確認画面に出せるよう、店舗名で代用する。
        assert.equal(drafts[0].items[0].rawName, "イオン西新井店")
        assert.equal(drafts[0].totalAmount, 644)
    })

    it("separates different stores on the same day", () => {
        const drafts = buildLinkedReceiptDrafts(
            [
                entry({ id: 31, place: "イオン西新井店", amount: 500 }),
                entry({ id: 32, place: "セブンイレブン", amount: 300 }),
            ],
            options
        )

        assert.equal(drafts.length, 2)
        assert.deepEqual(
            drafts.map((draft) => draft.totalAmount).sort((a, b) => a - b),
            [300, 500]
        )
    })

    it("keeps the same store on different days apart", () => {
        const drafts = buildLinkedReceiptDrafts(
            [
                entry({ id: 41, date: "2026-08-20", amount: 500 }),
                entry({ id: 42, date: "2026-08-21", amount: 300 }),
            ],
            options
        )

        assert.deepEqual(
            drafts.map((draft) => draft.purchasedAt),
            ["2026-08-20", "2026-08-21"]
        )
    })

    it("merges Amazon items charged on the same day and splits shipments charged on other days", () => {
        const drafts = buildLinkedReceiptDrafts(
            [
                entry({
                    id: 51,
                    fromAccountId: AMAZON_ACCOUNT,
                    place: null,
                    name: "USBケーブル",
                    date: "2026-08-18",
                    amount: 1280,
                    categoryId: null,
                    genreId: null,
                }),
                entry({
                    id: 52,
                    fromAccountId: AMAZON_ACCOUNT,
                    place: null,
                    name: "電池",
                    date: "2026-08-18",
                    amount: 780,
                    categoryId: null,
                    genreId: null,
                }),
                entry({
                    id: 53,
                    fromAccountId: AMAZON_ACCOUNT,
                    place: null,
                    name: "本",
                    date: "2026-08-22",
                    amount: 1650,
                    categoryId: null,
                    genreId: null,
                }),
            ],
            options
        )

        assert.equal(drafts.length, 2)
        // 同時決済ぶんはまとまり、分割発送で決済日が分かれたぶんは別の取り込みになる。
        assert.equal(drafts[0].totalAmount, 2060)
        assert.equal(drafts[0].source, "AMAZON")
        // place が空の明細は口座名を店舗名にする。
        assert.equal(drafts[0].storeName, "Amazon.co.jp")
        assert.equal(drafts[1].totalAmount, 1650)
    })

    it("carries the classification Zaim attached, so it can be corrected later", () => {
        const drafts = buildLinkedReceiptDrafts([entry({ id: 61 })], options)
        assert.equal(drafts[0].items[0].zaimCategoryId, 101)
        assert.equal(drafts[0].items[0].zaimGenreId, 29784033)
    })

    it("builds a source key that survives store-name spacing differences", () => {
        assert.equal(
            buildSourceKey(SMART_RECEIPT_ACCOUNT, "2026-08-20", "イオン 西新井店"),
            buildSourceKey(SMART_RECEIPT_ACCOUNT, "2026-08-20", "イオン西新井")
        )
    })
})

describe("buildLinkedReceiptDrafts: 商品別の明細（#663）", () => {
    const detail = (name: string, amount: number) => ({
        name,
        amount,
        quantity: null,
        unitPrice: null,
        discount: null,
        tax: null,
        categoryName: null,
        genreName: null,
    })

    it("商品別の明細が無い明細は、代表商品名＋取引合計の行として印を付ける（商品として確定させない）", () => {
        const [draft] = buildLinkedReceiptDrafts(
            [entry({ id: 1, name: "玉子L6個入", amount: 1543 })],
            options
        )
        assert.equal(draft.items.length, 1)
        assert.equal(draft.items[0].detailMissing, true)
        assert.equal(draft.items[0].snapshot.kind, "representative")
        assert.equal(draft.detailChecks[0].state, "missing")
        assert.equal(draft.totalAmount, 1543)
    })

    it("商品別の明細があれば全商品を各金額のまま展開し、合計は取引合計のまま", () => {
        const [draft] = buildLinkedReceiptDrafts(
            [
                entry({
                    id: 1,
                    name: "玉子L6個入",
                    amount: 1543,
                    detailItems: [detail("玉子L6個入", 248), detail("牛乳", 295), detail("食パン", 1000)],
                }),
            ],
            options
        )
        assert.deepEqual(
            draft.items.map((item) => [item.rawName, item.amount, item.detailMissing]),
            [["玉子L6個入", 248, false], ["牛乳", 295, false], ["食パン", 1000, false]]
        )
        assert.equal(draft.items.every((item) => item.sourceZaimMoneyId === 1), true)
        assert.equal(draft.totalAmount, 1543)
        assert.equal(draft.detailChecks[0].state, "complete")
    })

    it("合計が合わないときは差額を残し、どの商品の金額も書き換えない", () => {
        const [draft] = buildLinkedReceiptDrafts(
            [entry({ id: 1, amount: 1543, detailItems: [detail("玉子", 248), detail("牛乳", 295)] })],
            options
        )
        assert.deepEqual(draft.items.map((item) => item.amount), [248, 295])
        assert.equal(draft.totalAmount, 1543)
        assert.equal(draft.detailChecks[0].state, "mismatch")
        assert.equal(draft.detailChecks[0].difference, 1000)
    })

    it("同日同店舗の別取引は商品を混ぜず、取引ごとの判定を持つ", () => {
        const [draft] = buildLinkedReceiptDrafts(
            [
                entry({ id: 1, amount: 543, detailItems: [detail("玉子", 543)] }),
                entry({ id: 2, amount: 1000, name: "米" }),
            ],
            options
        )
        assert.deepEqual(draft.detailChecks.map((check) => [check.sourceZaimMoneyId, check.state]), [
            [1, "complete"],
            [2, "missing"],
        ])
        assert.deepEqual(draft.items.map((item) => [item.sourceZaimMoneyId, item.detailMissing]), [
            [1, false],
            [2, true],
        ])
    })
})
