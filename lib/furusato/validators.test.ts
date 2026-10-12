import assert from "node:assert/strict"
import { test } from "node:test"
import {
    CreateFurusatoDonationSchema,
    RECEIVE_RANGE_MESSAGE,
    STATUS_COMBINATION_MESSAGE,
    UpdateFurusatoDonationSchema,
    checkDonationRules,
    parseDateInput,
} from "./validators"

const base = { donatedAt: "2026-09-28", municipality: "北海道 紋別市", amount: 60000 }

test("受取予定は両端・片側だけ・未設定のいずれも保存できる", () => {
    for (const range of [
        { receiveFrom: "2026-10-01", receiveTo: "2026-11-30" },
        { receiveFrom: "2026-10-01" },
        { receiveTo: "2026-11-30" },
        { receiveFrom: "2026-10-01", receiveTo: "2026-10-01" },
        {},
    ]) {
        assert.equal(CreateFurusatoDonationSchema.safeParse({ ...base, ...range }).success, true, JSON.stringify(range))
    }
})

test("開始日が終了日より後なら理由付きで拒否する", () => {
    const parsed = CreateFurusatoDonationSchema.safeParse({ ...base, receiveFrom: "2026-12-01", receiveTo: "2026-10-01" })
    assert.equal(parsed.success, false)
    assert.equal(parsed.error?.issues[0]?.message, RECEIVE_RANGE_MESSAGE)
})

test("確定申告へ切替なのに証明書が不要の組み合わせは拒否する", () => {
    const parsed = CreateFurusatoDonationSchema.safeParse({ ...base, oneStopStatus: "switchedToTaxReturn", certificateStatus: "notNeeded" })
    assert.equal(parsed.success, false)
    assert.equal(parsed.error?.issues[0]?.message, STATUS_COMBINATION_MESSAGE)
    assert.equal(checkDonationRules({ receiveFrom: null, receiveTo: null, oneStopStatus: "accepted", certificateStatus: "notNeeded" }), null)
})

test("空文字・null は未設定へ戻す指定、undefined は変更しない指定として区別する", () => {
    const cleared = UpdateFurusatoDonationSchema.parse({ receiveFrom: "", receiveTo: null, returnItem: "" })
    assert.equal(cleared.receiveFrom, null)
    assert.equal(cleared.receiveTo, null)
    assert.equal(cleared.returnItem, null)
    const untouched = UpdateFurusatoDonationSchema.parse({})
    assert.equal(untouched.receiveFrom, undefined)
    assert.equal(untouched.memo, undefined)
})

test("寄付額・自治体名・日付の不正を弾く", () => {
    assert.equal(CreateFurusatoDonationSchema.safeParse({ ...base, amount: 0 }).success, false)
    assert.equal(CreateFurusatoDonationSchema.safeParse({ ...base, municipality: "  " }).success, false)
    assert.equal(CreateFurusatoDonationSchema.safeParse({ ...base, donatedAt: "2026-02-30" }).success, false)
    assert.equal(CreateFurusatoDonationSchema.safeParse({ ...base, oneStopStatus: "unknown" }).success, false)
})

test("日付入力はUTCの0時として読む", () => {
    assert.equal(parseDateInput("2026-12-31")?.toISOString(), "2026-12-31T00:00:00.000Z")
    assert.equal(parseDateInput("2026-1-1"), null)
})
