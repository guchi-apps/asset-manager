import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { decidePaymentImport, validatePaymentImportInput } from "@/lib/payment-import"

const rule = {
    normalizedName: "netflix",
    storeName: "Netflix",
    zaimCategoryId: 1,
    zaimGenreId: 2,
    categoryName: "通信費",
    genreName: "インターネット接続料",
    correctionCount: 2,
}

describe("payment import", () => {
    it("明確な入力を自動反映対象にする", () => {
        assert.equal(decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.95 }, rule, true, true).status, "imported")
    })

    it("分類または口座が不明なら確認待ちにする", () => {
        assert.equal(decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.95 }, null, true, true).status, "pendingReview")
        assert.equal(decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.95 }, rule, false, true).status, "pendingReview")
    })

    it("使用量を受け取り、省略もできる", () => {
        const base = { source: "gmail", gmailMessageId: "m1", date: "2026-08-30", amount: 7842, place: "関西電力", name: "電気料金" }
        assert.equal(validatePaymentImportInput({ ...base, usage: " 258 kWh " }).usage, "258 kWh")
        assert.equal(validatePaymentImportInput(base).usage, null)
        assert.equal(validatePaymentImportInput({ ...base, usage: "" }).usage, null)
    })

    it("使用量が文字列でない・長すぎる場合は弾く", () => {
        const base = { source: "gmail", gmailMessageId: "m1", date: "2026-08-30", amount: 7842, place: "関西電力", name: "電気料金" }
        assert.throws(() => validatePaymentImportInput({ ...base, usage: 258 }))
        assert.throws(() => validatePaymentImportInput({ ...base, usage: "k".repeat(33) }))
    })

    it("入力形式を検証する", () => {
        assert.throws(() => validatePaymentImportInput({ source: "gmail", gmailMessageId: "m1", date: "2026-02-30", amount: 100, place: "店", name: "商品" }))
        assert.equal(validatePaymentImportInput({ source: "gmail", gmailMessageId: "m1", date: "2026-08-30", amount: 100, place: "店", name: "商品" }).amount, 100)
    })

    it("時刻付きの購入日時を受け取る（Issue #323）", () => {
        const base = { source: "gmail", gmailMessageId: "m1", amount: 100, place: "店", name: "商品" }
        assert.equal(validatePaymentImportInput({ ...base, date: "2026-08-30T14:23" }).date, "2026-08-30T14:23")
        assert.equal(validatePaymentImportInput({ ...base, date: " 2026-08-30T14:23:45 " }).date, "2026-08-30T14:23:45")
        assert.equal(validatePaymentImportInput({ ...base, date: "2026-08-30T05:23:00Z" }).date, "2026-08-30T05:23:00Z")
        // 日付だけの従来の入力も引き続き受け付ける
        assert.equal(validatePaymentImportInput({ ...base, date: "2026-08-30" }).date, "2026-08-30")
    })

    it("時刻の形が不正なものは弾く（Issue #323）", () => {
        const base = { source: "gmail", gmailMessageId: "m1", amount: 100, place: "店", name: "商品" }
        assert.throws(() => validatePaymentImportInput({ ...base, date: "2026-08-30T14" }))
        assert.throws(() => validatePaymentImportInput({ ...base, date: "2026-08-30 14:23" }))
        assert.throws(() => validatePaymentImportInput({ ...base, date: "2026-08-30T25:00" }))
    })
})
