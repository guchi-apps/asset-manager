import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { accountKey, isPendingAccount, jstMonthKey, resolveCoveredMonths } from "./replace-target"

describe("isPendingAccount", () => {
    it("設定した反映待ち口座のidなら true", () => {
        assert.equal(isPendingAccount({ zaimAccountId: 5, name: "何か" }, 5), true)
    })

    it("idが未設定でも、口座名が「反映待ち」なら true", () => {
        assert.equal(isPendingAccount({ zaimAccountId: 5, name: "反映待ち" }, null), true)
        assert.equal(isPendingAccount({ zaimAccountId: 5, name: " 反映待ち " }, 9), true)
    })

    it("カードの口座は false", () => {
        assert.equal(isPendingAccount({ zaimAccountId: 7, name: "楽天カード" }, 5), false)
    })
})

describe("resolveCoveredMonths", () => {
    const now = new Date("2026-09-17T12:00:00+09:00")

    it("AIDEが months を返していればそれを使う", () => {
        assert.deepEqual(resolveCoveredMonths(["202608", "202609"], null, now), ["202608", "202609"])
    })

    it("months が無ければ、巡回した時刻（JST）の月だけとみなす", () => {
        // UTCでは8月末だが、JSTでは9月1日
        assert.deepEqual(resolveCoveredMonths(null, "2026-08-31T15:30:00Z", now), ["202609"])
    })

    it("巡回時刻も無ければ、いまの月にする", () => {
        assert.deepEqual(resolveCoveredMonths(null, null, now), ["202609"])
        assert.equal(jstMonthKey(new Date("2026-09-30T15:00:00Z")), "202610")
    })
})

describe("accountKey", () => {
    it("Web版の口座名の末尾の括弧書きを揃える", () => {
        assert.equal(accountKey("楽天カード(自動連携)"), accountKey("楽天カード"))
    })
})
