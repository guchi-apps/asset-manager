import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { checkPaymentAccount, registeredAccountAt } from "@/lib/subscription-payment-account-check"

const card = { id: 1, name: "三井住友カード" }
const bank = { id: 2, name: "給与口座" }

describe("registeredAccountAt", () => {
    const history = [
        { effectiveFrom: "2026-06-01", account: bank },
        { effectiveFrom: "2026-01-01", account: card },
    ]
    it("その日に適用されている履歴の口座を返す", () => {
        assert.equal(registeredAccountAt(history, "2026-03-15")?.id, 1)
        assert.equal(registeredAccountAt(history, "2026-06-01")?.id, 2)
    })
    it("最初の適用日より前は最古の履歴を使う", () => {
        assert.equal(registeredAccountAt(history, "2025-12-31")?.id, 1)
    })
    it("履歴が空なら null", () => {
        assert.equal(registeredAccountAt([], "2026-03-15"), null)
    })
})

describe("checkPaymentAccount", () => {
    it("口座が違えば登録側・実際の口座名を返す", () => {
        assert.deepEqual(checkPaymentAccount(card, bank), { registeredName: "三井住友カード", actualName: "給与口座" })
    })
    it("口座が同じなら null", () => {
        assert.equal(checkPaymentAccount(card, { id: 1, name: "別名" }), null)
    })
    it("登録側が口座なし・未設定、または明細に口座が無いときは判定しない", () => {
        assert.equal(checkPaymentAccount(null, bank), null)
        assert.equal(checkPaymentAccount(card, null), null)
    })
})
