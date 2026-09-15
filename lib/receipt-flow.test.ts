import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    daysSinceJst,
    receiptFlowStep,
    registerBlocker,
    type RegisterReadinessInput,
} from "./receipt-flow"

const ready: RegisterReadinessInput = {
    status: "REVIEW_REQUIRED",
    amountMatched: true,
    itemCount: 1,
    undecidedItemCount: 0,
    purchasedAt: "2026-09-12T00:00:00.000Z",
    storeName: "Netflix",
    cardAccountId: 100,
    webRegisterConfigured: true,
}

describe("receiptFlowStep", () => {
    it("確認待ち・確定済み・解析中は確認の手順に入る", () => {
        assert.equal(receiptFlowStep("REVIEW_REQUIRED"), "review")
        assert.equal(receiptFlowStep("CONFIRMED"), "review")
        assert.equal(receiptFlowStep("ANALYZING"), "review")
    })

    it("カードへ登録済みは反映待ち、置き換え済みは反映済み", () => {
        assert.equal(receiptFlowStep("SENT_TO_ZAIM"), "waiting")
        assert.equal(receiptFlowStep("REPLACED"), "done")
    })

    it("止まっている状態はどの手順にも入れない", () => {
        assert.equal(receiptFlowStep("MANUAL_ACTION_REQUIRED"), null)
        assert.equal(receiptFlowStep("FAILED"), null)
    })
})

describe("daysSinceJst", () => {
    it("時刻の差ではなくJSTの日付の差で数える", () => {
        // JST 9/13 23:30 → JST 9/14 08:00 は1日
        assert.equal(
            daysSinceJst("2026-09-13T14:30:00.000Z", new Date("2026-09-13T23:00:00.000Z")),
            1
        )
        // 同じJSTの日なら0日
        assert.equal(
            daysSinceJst("2026-09-13T15:30:00.000Z", new Date("2026-09-14T14:00:00.000Z")),
            0
        )
    })

    it("月をまたいでも数えられる", () => {
        assert.equal(
            daysSinceJst("2026-08-28T03:00:00.000Z", new Date("2026-09-14T03:00:00.000Z")),
            17
        )
    })

    it("日付が無い・読めないときは null", () => {
        assert.equal(daysSinceJst(null, new Date()), null)
        assert.equal(daysSinceJst("not-a-date", new Date()), null)
    })
})

describe("registerBlocker", () => {
    it("条件が揃っていれば null（確定済みでも同じ）", () => {
        assert.equal(registerBlocker(ready), null)
        assert.equal(registerBlocker({ ...ready, status: "CONFIRMED" }), null)
    })

    it("金額不一致・内訳未決定は修正へ誘導する理由を返す", () => {
        assert.equal(
            registerBlocker({ ...ready, amountMatched: false }),
            "商品の合計が総額と一致していません"
        )
        assert.equal(
            registerBlocker({ ...ready, undecidedItemCount: 2 }),
            "内訳が決まっていない商品が2品あります"
        )
    })

    it("登録に要る値が欠けていれば理由を返す", () => {
        assert.match(registerBlocker({ ...ready, purchasedAt: null }) ?? "", /購入日/)
        assert.match(registerBlocker({ ...ready, storeName: "  " }) ?? "", /店舗名/)
        assert.match(registerBlocker({ ...ready, cardAccountId: null }) ?? "", /カード/)
        assert.match(registerBlocker({ ...ready, webRegisterConfigured: false }) ?? "", /AIDE/)
        assert.match(registerBlocker({ ...ready, itemCount: 0 }) ?? "", /商品がありません/)
    })

    it("確認の手順にない状態では押させない", () => {
        assert.equal(registerBlocker({ ...ready, status: "ANALYZING" }), "解析中です")
        assert.notEqual(registerBlocker({ ...ready, status: "SENT_TO_ZAIM" }), null)
        assert.notEqual(registerBlocker({ ...ready, status: "MANUAL_ACTION_REQUIRED" }), null)
    })
})
