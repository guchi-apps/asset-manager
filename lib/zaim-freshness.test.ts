import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    describeStaleZaimAccounts,
    describeZaimFreshness,
    formatZaimAge,
    formatZaimFetchedAt,
    type ZaimFreshness,
} from "./zaim-freshness"

const FRESH: ZaimFreshness = {
    fetchedAt: "2026-08-25T14:35:00.000Z",
    ageMinutes: 120,
    stale: false,
    empty: false,
    staleAccounts: [],
}

describe("formatZaimAge", () => {
    it("分・時間・日で単位を切り替える", () => {
        assert.equal(formatZaimAge(0), "たった今")
        assert.equal(formatZaimAge(45), "45分前")
        assert.equal(formatZaimAge(120), "2時間前")
        assert.equal(formatZaimAge(60 * 25), "1日前")
    })
})

describe("formatZaimFetchedAt", () => {
    it("JSTの月日と時刻にする", () => {
        // 14:35 UTC = 23:35 JST。UTCで動く本番VPSでも日本時間で出す。
        assert.equal(formatZaimFetchedAt("2026-08-25T14:35:00.000Z"), "08/25 23:35")
    })

    it("日時として読めない値はそのまま返す", () => {
        assert.equal(formatZaimFetchedAt("なにか"), "なにか")
    })
})

describe("describeZaimFreshness", () => {
    it("取得時刻と経過時間を並べる", () => {
        assert.deepEqual(describeZaimFreshness(FRESH), {
            label: "Zaim取得: 08/25 23:35（2時間前）",
            warn: false,
        })
    })

    it("24時間を超えていれば警告にする", () => {
        const result = describeZaimFreshness({ ...FRESH, ageMinutes: 60 * 30, stale: true })
        assert.equal(result.label, "Zaim取得: 08/25 23:35（1日前）")
        assert.equal(result.warn, true)
    })

    it("まだ一度も巡回していない場合は警告にする", () => {
        assert.deepEqual(
            describeZaimFreshness({
                fetchedAt: null,
                ageMinutes: null,
                stale: true,
                empty: true,
                staleAccounts: [],
            }),
            { label: "Zaim取得: まだ取得できていません", warn: true }
        )
    })
})

describe("describeStaleZaimAccounts", () => {
    it("当日でない口座が無ければ null", () => {
        assert.equal(describeStaleZaimAccounts([]), null)
    })

    it("4件以上は先頭3件と件数に畳む", () => {
        const message = describeStaleZaimAccounts(
            ["A銀行", "B銀行", "C銀行", "D銀行", "E銀行"].map((name) => ({
                name,
                lastUpdatedAt: null,
            }))
        )

        assert.match(message ?? "", /5件/)
        assert.match(message ?? "", /A銀行・B銀行・C銀行・ほか2件/)
    })
})
