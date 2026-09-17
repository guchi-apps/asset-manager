import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    confirmBlocker,
    daysSinceJst,
    isBeforeZaimRegister,
    PENDING_ACCOUNT_UNAVAILABLE_MESSAGE,
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
    pendingAccountAvailable: true,
    webRegisterConfigured: true,
}

describe("receiptFlowStep", () => {
    it("確認待ち・解析中は確認の手順に入る", () => {
        assert.equal(receiptFlowStep("REVIEW_REQUIRED"), "review")
        assert.equal(receiptFlowStep("ANALYZING"), "review")
    })

    it("確定済み（未登録）は反映待ち、Zaimへ登録済みは反映（Issue #466）", () => {
        assert.equal(receiptFlowStep("CONFIRMED"), "waiting")
        assert.equal(receiptFlowStep("SENT_TO_ZAIM"), "reflect")
        assert.equal(receiptFlowStep("REPLACED"), "done")
    })

    it("止まっている状態はどの手順にも入れない", () => {
        assert.equal(receiptFlowStep("MANUAL_ACTION_REQUIRED"), null)
        assert.equal(receiptFlowStep("FAILED"), null)
    })
})

describe("isBeforeZaimRegister", () => {
    it("確認・反映待ちだけがZaimへ登録する前", () => {
        assert.equal(isBeforeZaimRegister("REVIEW_REQUIRED"), true)
        assert.equal(isBeforeZaimRegister("CONFIRMED"), true)
        assert.equal(isBeforeZaimRegister("SENT_TO_ZAIM"), false)
        assert.equal(isBeforeZaimRegister("REPLACED"), false)
        assert.equal(isBeforeZaimRegister("MANUAL_ACTION_REQUIRED"), false)
    })
})

describe("confirmBlocker", () => {
    it("中身が揃っていれば null。Zaimへ送らないので店舗名・口座・AIDE設定は見ない", () => {
        assert.equal(confirmBlocker(ready), null)
        assert.equal(confirmBlocker({ ...ready, purchasedAt: "2026-09-12T00:00:00.000Z" }), null)
    })

    it("金額不一致・内訳未決定・購入日なし・商品なしは理由を返す", () => {
        assert.equal(confirmBlocker({ ...ready, amountMatched: false }), "商品の合計が総額と一致していません")
        assert.equal(
            confirmBlocker({ ...ready, undecidedItemCount: 1 }),
            "内訳が決まっていない商品が1品あります"
        )
        assert.match(confirmBlocker({ ...ready, purchasedAt: null }) ?? "", /購入日/)
        assert.match(confirmBlocker({ ...ready, itemCount: 0 }) ?? "", /商品がありません/)
    })

    it("確認の手順にない状態では押させない", () => {
        assert.equal(confirmBlocker({ ...ready, status: "ANALYZING" }), "解析中です")
        assert.notEqual(confirmBlocker({ ...ready, status: "CONFIRMED" }), null)
        assert.notEqual(confirmBlocker({ ...ready, status: "SENT_TO_ZAIM" }), null)
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
    it("反映待ち口座が見つからなければ止める（Issue #464）", () => {
        assert.equal(
            registerBlocker({ ...ready, pendingAccountAvailable: false }),
            PENDING_ACCOUNT_UNAVAILABLE_MESSAGE
        )
        assert.equal(registerBlocker({ ...ready, pendingAccountAvailable: true }), null)
    })

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
        assert.match(registerBlocker({ ...ready, pendingAccountAvailable: false }) ?? "", /反映待ち/)
        assert.match(registerBlocker({ ...ready, webRegisterConfigured: false }) ?? "", /AIDE/)
        assert.match(registerBlocker({ ...ready, itemCount: 0 }) ?? "", /商品がありません/)
    })

    it("登録前の手順にない状態では押させない", () => {
        assert.equal(registerBlocker({ ...ready, status: "ANALYZING" }), "解析中です")
        assert.notEqual(registerBlocker({ ...ready, status: "SENT_TO_ZAIM" }), null)
        assert.notEqual(registerBlocker({ ...ready, status: "MANUAL_ACTION_REQUIRED" }), null)
    })
})
