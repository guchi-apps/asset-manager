import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { describeSplitRegistration, detectSplitRegistration } from "./receipt-register-plan"

const at = new Date("2026-10-10T00:00:00Z")

describe("detectSplitRegistration", () => {
    it("未登録は対象外", () => {
        const r = { zaimReceiptRequestId: null, items: [{ zaimRegisteredAt: null }, { zaimRegisteredAt: null }] }
        assert.equal(detectSplitRegistration(r), "none")
    })

    it("旧経路で一部だけ登録済みを見分ける", () => {
        const r = { zaimReceiptRequestId: null, items: [{ zaimRegisteredAt: at }, { zaimRegisteredAt: null }] }
        assert.equal(detectSplitRegistration(r), "partial")
    })

    it("旧経路で全商品登録済みを見分ける（#84のような取込）", () => {
        const r = { zaimReceiptRequestId: null, items: [{ zaimRegisteredAt: at }, { zaimRegisteredAt: at }] }
        assert.equal(detectSplitRegistration(r), "complete")
    })

    it("新経路（冪等キーあり）は分割扱いにしない", () => {
        const r = { zaimReceiptRequestId: "asset-manager:receipt:1", items: [{ zaimRegisteredAt: at }, { zaimRegisteredAt: at }] }
        assert.equal(detectSplitRegistration(r), "none")
    })

    it("1商品のレシートは分割ではない", () => {
        assert.equal(detectSplitRegistration({ zaimReceiptRequestId: null, items: [{ zaimRegisteredAt: at }] }), "none")
    })
})

describe("describeSplitRegistration", () => {
    it("二重に載ること・人が確認することを伝える", () => {
        const message = describeSplitRegistration("partial", 3, 7)
        assert.match(message, /3\/7/)
        assert.match(message, /二重/)
    })
})
