import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    DEFAULT_AIDE_BASE_URL,
    getZaimAideConfig,
    parseMoneySummary,
    ZaimAideError,
} from "./zaim-aide"

/** 環境変数を触るテストは、終わったら必ず元へ戻す（他のテストへ漏らさない）。 */
function withEnv(values: Record<string, string | undefined>, run: () => void) {
    const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
    try {
        for (const [key, value] of Object.entries(values)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
        run()
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    }
}

describe("getZaimAideConfig", () => {
    it("AIDE_READ_SECRET が無ければ null を返す", () => {
        withEnv({ AIDE_READ_SECRET: undefined, AIDE_BASE_URL: undefined }, () => {
            assert.equal(getZaimAideConfig(), null)
        })
    })

    it("AIDE_BASE_URL 未指定ならVPS内のlocalhostを使う", () => {
        withEnv({ AIDE_READ_SECRET: "secret", AIDE_BASE_URL: undefined }, () => {
            assert.deepEqual(getZaimAideConfig(), {
                baseUrl: DEFAULT_AIDE_BASE_URL,
                secret: "secret",
            })
        })
    })

    it("末尾のスラッシュを落とす（パスが // にならないようにする）", () => {
        withEnv({ AIDE_READ_SECRET: "secret", AIDE_BASE_URL: "http://127.0.0.1:9999/" }, () => {
            assert.equal(getZaimAideConfig()?.baseUrl, "http://127.0.0.1:9999")
        })
    })
})

describe("parseMoneySummary", () => {
    const SUMMARY = {
        empty: false,
        fetchedAt: "2026-08-25T14:35:00.000Z",
        ageMinutes: 120,
        stale: false,
        totals: { balances: 1000000, holdings: 234567 },
        balances: [{ name: "三菱UFJ銀行", amount: 1000000, lastUpdatedAt: "2026-08-25T23:20:11+09:00" }],
        holdings: [
            {
                account: "SBI証券",
                name: "eMAXIS Slim 全世界株式",
                amount: 234567,
                occurrence: 1,
                occurrenceCount: 2,
                lastUpdatedAt: "2026-08-25T23:21:00+09:00",
            },
        ],
        onlineAccounts: [{ name: "三菱UFJ銀行", lastUpdatedAt: "2026-08-25T23:20:11+09:00" }],
        staleAccounts: [{ name: "△△銀行", lastUpdatedAt: "2024-12-18T10:00:00+09:00" }],
        note: "...",
    }

    it("残高・保有銘柄と鮮度を取り出す", () => {
        const result = parseMoneySummary(SUMMARY)

        assert.deepEqual(result.snapshot.balances, [
            { name: "三菱UFJ銀行", amount: 1000000, lastUpdatedAt: "2026-08-25T23:20:11+09:00" },
        ])
        assert.deepEqual(result.snapshot.holdings, [
            {
                account: "SBI証券",
                name: "eMAXIS Slim 全世界株式",
                amount: 234567,
                occurrence: 1,
                occurrenceCount: 2,
                lastUpdatedAt: "2026-08-25T23:21:00+09:00",
            },
        ])
        assert.equal(result.fetchedAt, "2026-08-25T14:35:00.000Z")
        assert.equal(result.ageMinutes, 120)
        assert.equal(result.stale, false)
        assert.equal(result.empty, false)
        assert.deepEqual(result.staleAccounts, [
            { name: "△△銀行", lastUpdatedAt: "2024-12-18T10:00:00+09:00" },
        ])
    })

    it("キャッシュが空でも例外にせず empty で返す", () => {
        const result = parseMoneySummary({
            empty: true,
            fetchedAt: null,
            ageMinutes: null,
            stale: true,
            balances: [],
            holdings: [],
            staleAccounts: [],
        })

        assert.equal(result.empty, true)
        assert.equal(result.fetchedAt, null)
        assert.deepEqual(result.snapshot, { balances: [], holdings: [] })
    })

    it("名称・金額が欠けた行は落とす（1行の欠けで取得全体を失敗させない）", () => {
        const result = parseMoneySummary({
            balances: [
                { name: "", amount: 100 },
                { name: "残高未取得", amount: null },
                { name: "楽天カード", amount: -45600 },
            ],
            holdings: [
                { account: "SBI証券", name: "", amount: 1 },
                { account: "", name: "オルカン", amount: 1 },
            ],
        })

        assert.deepEqual(result.snapshot.balances, [
            { name: "楽天カード", amount: -45600, lastUpdatedAt: null },
        ])
        assert.deepEqual(result.snapshot.holdings, [])
    })

    it("出現順を持たない古い形のキャッシュは1件だけの行として扱う", () => {
        const result = parseMoneySummary({
            balances: [],
            holdings: [{ account: "SBI証券", name: "オルカン", amount: 100 }],
        })

        assert.equal(result.snapshot.holdings[0].occurrence, 1)
        assert.equal(result.snapshot.holdings[0].occurrenceCount, 1)
    })

    it("最終更新を持たない行は null にする（連携していない口座）", () => {
        const result = parseMoneySummary({
            balances: [{ name: "財布", amount: 6578 }],
            holdings: [{ account: "SBI証券", name: "オルカン", amount: 100 }],
        })

        assert.equal(result.snapshot.balances[0].lastUpdatedAt, null)
        assert.equal(result.snapshot.holdings[0].lastUpdatedAt, null)
    })

    it("応答がオブジェクトでなければ ZaimAideError を投げる", () => {
        assert.throws(() => parseMoneySummary(null), ZaimAideError)
        assert.throws(() => parseMoneySummary("boom"), ZaimAideError)
    })
})
