import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    describeStaleZaimAccounts,
    describeZaimFreshness,
    formatZaimAge,
    formatZaimFetchedAt,
    isStaleForDay,
    resolveEntryRecordDayKey,
    resolveZaimRecordedAt,
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

describe("resolveZaimRecordedAt", () => {
    it("巡回した時刻を記録日時にする（実行時刻ではない）", () => {
        // 8/26 10:00 JST のデプロイ直後に走っても、読むのは 8/25 23:35 JST の巡回結果。
        const now = new Date("2026-08-26T01:00:00.000Z")
        const recordedAt = resolveZaimRecordedAt("2026-08-25T14:35:00.000Z", now)

        assert.equal(recordedAt.toISOString(), "2026-08-25T14:35:00.000Z")
    })

    it("まだ一度も巡回していなければ実行時刻へ落とす", () => {
        const now = new Date("2026-08-26T01:00:00.000Z")

        assert.equal(resolveZaimRecordedAt(null, now), now)
        assert.equal(resolveZaimRecordedAt("読めない値", now), now)
    })
})

describe("isStaleForDay", () => {
    it("最終更新が記録日より前なら true", () => {
        assert.equal(isStaleForDay("2026-08-24T23:20:11+09:00", "2026-08-25"), true)
    })

    it("最終更新が記録日と同じなら false", () => {
        assert.equal(isStaleForDay("2026-08-25T00:05:00+09:00", "2026-08-25"), false)
        assert.equal(isStaleForDay("2026-08-25T23:20:11+09:00", "2026-08-25"), false)
    })

    it("JSTの日付で判定する（UTCでは前日になる時刻でも当日扱い）", () => {
        // 2026-08-25T00:30+09:00 は UTC では 8/24 15:30。
        assert.equal(isStaleForDay("2026-08-25T00:30:00+09:00", "2026-08-25"), false)
    })

    it("最終更新を持たない行は対象にしない（連携していない口座）", () => {
        assert.equal(isStaleForDay(null, "2026-08-25"), false)
        assert.equal(isStaleForDay("読めない値", "2026-08-25"), false)
    })

    it("記録日より後の最終更新は止めない", () => {
        assert.equal(isStaleForDay("2026-08-26T09:00:00+09:00", "2026-08-25"), false)
    })
})

describe("resolveEntryRecordDayKey", () => {
    it("最終更新が巡回日と同じならその日へ記録する", () => {
        assert.equal(resolveEntryRecordDayKey("2026-08-26T23:16:16+09:00", "2026-08-26"), "2026-08-26")
    })

    it("巡回時刻までに当日の残高が載らない口座は前日ぶんとして記録する", () => {
        // SBI証券は毎晩23:50頃にしか反映されず、23:35の巡回では前日の残高のままになる（#258）。
        assert.equal(resolveEntryRecordDayKey("2026-08-25T23:50:43+09:00", "2026-08-26"), "2026-08-25")
    })

    it("連携していない口座・読めない時刻は巡回日へ落とす", () => {
        assert.equal(resolveEntryRecordDayKey(null, "2026-08-26"), "2026-08-26")
        assert.equal(resolveEntryRecordDayKey("読めない値", "2026-08-26"), "2026-08-26")
    })

    it("2日以上前から止まっている口座は書き戻さない（巡回日のまま返して鮮度判定へ渡す）", () => {
        const dayKey = resolveEntryRecordDayKey("2026-06-05T00:32:01+09:00", "2026-08-26")

        assert.equal(dayKey, "2026-08-26")
        assert.equal(isStaleForDay("2026-06-05T00:32:01+09:00", dayKey), true)
    })

    it("巡回日より後の最終更新は未来の日付へ書かない", () => {
        assert.equal(resolveEntryRecordDayKey("2026-08-27T09:00:00+09:00", "2026-08-26"), "2026-08-26")
    })

    it("月をまたぐ前日も正しく求める", () => {
        assert.equal(resolveEntryRecordDayKey("2026-07-31T23:50:00+09:00", "2026-08-01"), "2026-07-31")
    })
})
