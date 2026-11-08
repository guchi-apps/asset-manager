import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    applyAlreadyRecorded,
    describeDataFetchReason,
    describeDataFetchStatus,
    groupSkippedItemsByReason,
    isAlreadyRecordedItem,
    resolveSkippedReasonKey,
    formatDataFetchTimestamp,
    formatRecordDay,
    resolveDataFetchStatus,
    resolveDataFetchTrigger,
    resolveScheduledRunDayKey,
    resolveValueDelta,
} from "./data-fetch-view"

const noCounts = { reflected: 0, skipped: 0, unmatched: 0, failed: 0 }

describe("resolveDataFetchStatus", () => {
    it("is SUCCESS when everything was reflected", () => {
        assert.equal(resolveDataFetchStatus({ ...noCounts, reflected: 12 }), "SUCCESS")
    })

    it("is PARTIAL when some entries were skipped", () => {
        assert.equal(
            resolveDataFetchStatus({ ...noCounts, reflected: 12, skipped: 3 }),
            "PARTIAL"
        )
    })

    it("is PARTIAL when nothing was matched but something was reflected", () => {
        assert.equal(
            resolveDataFetchStatus({ ...noCounts, reflected: 1, unmatched: 2 }),
            "PARTIAL"
        )
    })

    it("is FAILED when nothing was reflected and something failed", () => {
        assert.equal(resolveDataFetchStatus({ ...noCounts, failed: 4 }), "FAILED")
    })

    it("is PARTIAL when a failure sits next to a reflected entry", () => {
        assert.equal(resolveDataFetchStatus({ ...noCounts, reflected: 3, failed: 1 }), "PARTIAL")
    })

    // 「1件も反映できなかった」と「そもそも保存を試みなかった」は原因が違う。
    it("is SKIPPED when the run never got as far as saving", () => {
        assert.equal(
            resolveDataFetchStatus({ ...noCounts, failed: 1 }, { nothingSaved: true }),
            "SKIPPED"
        )
    })

    it("is SUCCESS for a run with nothing to do", () => {
        assert.equal(resolveDataFetchStatus(noCounts), "SUCCESS")
    })
})

describe("describeDataFetchReason", () => {
    it("puts the Zaim last-updated time into the advice when it is known", () => {
        const described = describeDataFetchReason("staleSource", "08/25 04:12")
        assert.equal(described.badge, "Zaim側が古い")
        assert.ok(described.advice.includes("08/25 04:12"))
        assert.equal(described.tone, "warn")
    })

    it("falls back to a generic advice when the detail is missing", () => {
        const described = describeDataFetchReason("staleSource", null)
        assert.ok(described.advice.includes("連携口座"))
    })

    // DBには文字列が入る。知らないコードでも表示が壊れないこと。
    it("keeps rendering for an unknown reason code", () => {
        const described = describeDataFetchReason("somethingNew", "詳細")
        assert.equal(described.badge, "未反映")
        assert.equal(described.advice, "詳細")
    })

    it("tells the user where to fix an unmatched entry", () => {
        assert.ok(describeDataFetchReason("unmatched").advice.includes("Zaim対応付け設定"))
    })
})

describe("resolveValueDelta", () => {
    it("reports an increase", () => {
        assert.deepEqual(resolveValueDelta(110000, 100000), { diff: 10000, direction: "up" })
    })

    it("reports a decrease", () => {
        assert.deepEqual(resolveValueDelta(98000, 100000), { diff: -2000, direction: "down" })
    })

    it("reports no change as flat rather than as an increase", () => {
        assert.deepEqual(resolveValueDelta(100000, 100000), { diff: 0, direction: "flat" })
    })

    it("has nothing to compare against on the first record", () => {
        assert.equal(resolveValueDelta(100000, null), null)
    })
})

describe("formatRecordDay", () => {
    it("drops the year", () => {
        assert.equal(formatRecordDay("2026-08-29"), "08-29")
    })

    it("passes through an unexpected shape untouched", () => {
        assert.equal(formatRecordDay("2026-08"), "2026-08")
    })

    it("shows a dash when there is no record day", () => {
        assert.equal(formatRecordDay(null), "—")
    })
})

describe("formatDataFetchTimestamp", () => {
    // 記録はUTCで入る。画面はJSTで読むため、日付をまたぐ時刻で確かめる。
    it("renders in JST", () => {
        assert.equal(formatDataFetchTimestamp("2026-08-29T14:50:00Z"), "08/29 23:50")
    })

    it("shows a dash for an unparsable value", () => {
        assert.equal(formatDataFetchTimestamp("not-a-date"), "—")
    })
})

describe("resolveDataFetchTrigger", () => {
    // 判定に使うのはJSTの時刻。cronは 23:50 / 18:00 JSTで発火する。
    const zaimCron = new Date("2026-08-29T14:50:00Z") // JST 23:50
    const indexCron = new Date("2026-08-29T09:00:00Z") // JST 18:00

    it("treats a PM2 run at the cron time as the scheduled one", () => {
        assert.equal(
            resolveDataFetchTrigger({ job: "ZAIM_VALUATION", at: zaimCron, underPm2: true }),
            "SCHEDULED"
        )
        assert.equal(
            resolveDataFetchTrigger({ job: "INDEX_VALUE", at: indexCron, underPm2: true }),
            "SCHEDULED"
        )
    })

    // `npx -y tsx` の起動に数分かかることがあるため、遅れて始まっても定期実行として扱う。
    it("allows a late start inside the window", () => {
        assert.equal(
            resolveDataFetchTrigger({
                job: "ZAIM_VALUATION",
                at: new Date("2026-08-29T15:19:00Z"), // JST 00:19（日付をまたぐ）
                underPm2: true,
            }),
            "SCHEDULED"
        )
    })

    // デプロイ時の `pm2 start` は cron の時刻と無関係に1回起動する（#276）。
    it("treats a PM2 run outside the window as the run right after a deploy", () => {
        assert.equal(
            resolveDataFetchTrigger({
                job: "ZAIM_VALUATION",
                at: new Date("2026-08-29T05:00:00Z"), // JST 14:00
                underPm2: true,
            }),
            "DEPLOY"
        )
    })

    it("treats a run outside PM2 as a hand-run", () => {
        assert.equal(
            resolveDataFetchTrigger({ job: "ZAIM_VALUATION", at: zaimCron, underPm2: false }),
            "MANUAL"
        )
    })
})

describe("resolveScheduledRunDayKey (#1232)", () => {
    it("uses the day of the scheduled run", () => {
        assert.equal(
            resolveScheduledRunDayKey({
                job: "ZAIM_VALUATION",
                at: new Date("2026-11-08T14:50:12Z"), // JST 11/08 23:50
                underPm2: true,
            }),
            "2026-11-08"
        )
    })

    // 23:50 の起動が遅れて0時をまたいでも、実行日は発火した日（前日）のまま。
    it("keeps the fired day when a late start crosses midnight", () => {
        assert.equal(
            resolveScheduledRunDayKey({
                job: "ZAIM_VALUATION",
                at: new Date("2026-11-08T15:04:40Z"), // JST 11/09 00:04
                underPm2: true,
            }),
            "2026-11-08"
        )
    })

    it("returns null for the run right after a deploy", () => {
        assert.equal(
            resolveScheduledRunDayKey({
                job: "ZAIM_VALUATION",
                at: new Date("2026-11-09T05:00:00Z"), // JST 11/09 14:00
                underPm2: true,
            }),
            null
        )
    })

    it("returns null for a hand-run even inside the window", () => {
        assert.equal(
            resolveScheduledRunDayKey({
                job: "ZAIM_VALUATION",
                at: new Date("2026-11-08T15:04:40Z"),
                underPm2: false,
            }),
            null
        )
    })
})

describe("isAlreadyRecordedItem (#1227)", () => {
    const skipped = { outcome: "SKIPPED" as const, reason: "existing", amount: 1000, previousValue: 1000 }

    it("treats an existing value equal to the fetched one as already recorded", () => {
        assert.equal(isAlreadyRecordedItem(skipped), true)
        assert.equal(resolveSkippedReasonKey(skipped), "alreadyRecorded")
    })

    it("keeps an existing value that differs as a real skip", () => {
        const differs = { ...skipped, previousValue: 900 }
        assert.equal(isAlreadyRecordedItem(differs), false)
        assert.equal(resolveSkippedReasonKey(differs), "existing")
    })

    // staleSource の previousValue は記録日より前の直近の値。Zaimが止まった口座は前日と同額になるため、隠してはいけない
    it("does not hide a stale source even when the amount equals the previous value", () => {
        const stale = { ...skipped, reason: "staleSource" }
        assert.equal(isAlreadyRecordedItem(stale), false)
        assert.equal(resolveSkippedReasonKey(stale), "staleSource")
        assert.equal(isAlreadyRecordedItem({ ...skipped, reason: "largeDiff" }), false)
    })

    it("ignores items without an amount and items that were not skipped", () => {
        assert.equal(isAlreadyRecordedItem({ ...skipped, amount: null, previousValue: null }), false)
        assert.equal(isAlreadyRecordedItem({ ...skipped, outcome: "REFLECTED" }), false)
    })
})

describe("groupSkippedItemsByReason (#1227)", () => {
    it("groups skipped items by reason in the order they first appear", () => {
        const items = [
            { id: 1, outcome: "REFLECTED" as const, reason: null, amount: 1, previousValue: 0 },
            { id: 2, outcome: "SKIPPED" as const, reason: "existing", amount: 5, previousValue: 4 },
            { id: 3, outcome: "SKIPPED" as const, reason: "existing", amount: 5, previousValue: 5 },
            { id: 4, outcome: "SKIPPED" as const, reason: "staleSource", amount: 7, previousValue: 7 },
            { id: 5, outcome: "SKIPPED" as const, reason: "existing", amount: 9, previousValue: 9 },
            { id: 6, outcome: "UNMATCHED" as const, reason: "unmatched", amount: 3, previousValue: null },
        ]
        const groups = groupSkippedItemsByReason(items)
        assert.deepEqual(
            groups.map((group) => [group.reason, group.items.map((item) => item.id)]),
            [
                ["existing", [2]],
                ["alreadyRecorded", [3, 5]],
                ["staleSource", [4]],
            ]
        )
    })
})

describe("applyAlreadyRecorded (#1227)", () => {
    const run = { job: "ZAIM_VALUATION" as const, status: "PARTIAL" as const, reflected: 0, skipped: 20, unmatched: 0, failed: 0 }

    it("moves same-value skips out of skipped and clears the partial status", () => {
        const result = applyAlreadyRecorded(run, 20)
        assert.equal(result.skipped, 0)
        assert.equal(result.alreadyRecorded, 20)
        assert.equal(result.status, "SUCCESS")
        assert.deepEqual(describeDataFetchStatus(result.status, result), { label: "反映済み（変更なし）", tone: "ok" })
    })

    it("stays partial while real skips remain", () => {
        const result = applyAlreadyRecorded(run, 17)
        assert.equal(result.skipped, 3)
        assert.equal(result.status, "PARTIAL")
    })

    it("keeps the usual label when something was written", () => {
        const result = applyAlreadyRecorded({ ...run, reflected: 2, skipped: 3 }, 3)
        assert.equal(describeDataFetchStatus(result.status, result).label, "保存まで完了")
    })

    it("leaves other jobs and a nothing-saved run untouched", () => {
        assert.equal(applyAlreadyRecorded({ ...run, job: "RECURRING_DEPOSIT" }, 5).skipped, 20)
        assert.equal(applyAlreadyRecorded({ ...run, status: "SKIPPED" }, 20).status, "SKIPPED")
    })

    it("labels the existing reason without assuming a manual entry", () => {
        assert.equal(describeDataFetchReason("existing").badge, "既存の値を優先")
        assert.equal(describeDataFetchReason("alreadyRecorded").tone, "ok")
    })
})
