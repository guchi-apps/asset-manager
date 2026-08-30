import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    describeDataFetchReason,
    formatDataFetchTimestamp,
    formatRecordDay,
    resolveDataFetchStatus,
    resolveDataFetchTrigger,
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
        assert.ok(describeDataFetchReason("unmatched").advice.includes("表示設定"))
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
