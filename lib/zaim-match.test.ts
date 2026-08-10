import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { matchZaimSnapshot } from "./zaim-match"
import { toMatchKey, type ZaimSnapshot } from "./zaim-scraper"

function aliasKeys(...aliases: string[]): string[] {
    return aliases.map(toMatchKey)
}

/** 同一口座内の同名行がない前提で occurrence を埋める */
function snapshotOf(
    balances: ZaimSnapshot["balances"],
    rows: { account: string; name: string; amount: number }[]
): ZaimSnapshot {
    const counts = new Map<string, number>()
    for (const row of rows) {
        const key = `${row.account}/${row.name}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const seen = new Map<string, number>()
    return {
        balances,
        holdings: rows.map((row) => {
            const key = `${row.account}/${row.name}`
            const occurrence = (seen.get(key) ?? 0) + 1
            seen.set(key, occurrence)
            return { ...row, occurrence, occurrenceCount: counts.get(key) ?? 1 }
        }),
    }
}

const SNAPSHOT: ZaimSnapshot = snapshotOf(
    [
        { name: "三菱UFJ銀行", amount: 1000 },
        { name: "SBI証券", amount: 5000000 },
        { name: "楽天証券", amount: 800000 },
    ],
    [
        { account: "SBI証券", name: "eMAXIS Slim 全世界株式", amount: 3000000 },
        { account: "SBI証券", name: "楽天VTI", amount: 2000000 },
        { account: "楽天証券", name: "eMAXIS Slim 全世界株式", amount: 500000 },
        { account: "楽天証券", name: "楽天VTI", amount: 300000 },
    ]
)

describe("matchZaimSnapshot", () => {
    it("口座名付きaliasで同じ銘柄を証券口座ごとに分けて対応付ける", () => {
        const result = matchZaimSnapshot(
            SNAPSHOT,
            aliasKeys("SBI証券/eMAXIS Slim 全世界株式", "楽天証券/eMAXIS Slim 全世界株式")
        )

        assert.deepEqual(
            result.matched.map((entry) => [entry.name, entry.amount]),
            [
                ["SBI証券/eMAXIS Slim 全世界株式", 3000000],
                ["楽天証券/eMAXIS Slim 全世界株式", 500000],
            ]
        )
    })

    it("銘柄名だけのaliasは口座をまたいで合算する", () => {
        const result = matchZaimSnapshot(SNAPSHOT, aliasKeys("eMAXIS Slim 全世界株式"))

        assert.deepEqual(
            result.matched.map((entry) => [entry.name, entry.amount]),
            [["eMAXIS Slim 全世界株式", 3500000]]
        )
    })

    it("空白・改行が混ざった名称でもaliasと一致する", () => {
        const snapshot = snapshotOf(
            [{ name: "楽天カー ド", amount: -45600 }],
            [{ account: "SBI 証券", name: "eMAXIS Slim\n全世界株式", amount: 3000000 }]
        )
        const result = matchZaimSnapshot(
            snapshot,
            aliasKeys("楽天カード", "SBI証券/eMAXIS Slim 全世界株式")
        )

        assert.equal(result.matched.length, 2)
        assert.deepEqual(result.unmatched, [])
    })

    it("銘柄を反映した証券口座の残高合計は二重計上しないよう除外する", () => {
        const result = matchZaimSnapshot(
            SNAPSHOT,
            aliasKeys("SBI証券/eMAXIS Slim 全世界株式", "SBI証券")
        )

        assert.deepEqual(
            result.matched.map((entry) => entry.name),
            ["SBI証券/eMAXIS Slim 全世界株式"]
        )
        // 合計側は候補から外れるため、未対応としても報告しない
        assert.ok(!result.unmatched.includes("SBI証券"))
    })

    it("銘柄を反映していない証券口座は残高合計で対応付けられる", () => {
        const result = matchZaimSnapshot(SNAPSHOT, aliasKeys("楽天証券"))

        assert.deepEqual(
            result.matched.map((entry) => [entry.name, entry.amount]),
            [["楽天証券", 800000]]
        )
    })

    it("同じ銘柄の一部だけ口座名付きで一致した場合、残りを合算しない", () => {
        const result = matchZaimSnapshot(
            SNAPSHOT,
            aliasKeys("SBI証券/eMAXIS Slim 全世界株式", "eMAXIS Slim 全世界株式")
        )

        assert.deepEqual(
            result.matched.map((entry) => [entry.name, entry.amount]),
            [["SBI証券/eMAXIS Slim 全世界株式", 3000000]]
        )
        assert.ok(result.unmatched.includes("楽天証券/eMAXIS Slim 全世界株式"))
    })

    it("未対応の銘柄は口座名付きの表記で報告する", () => {
        const result = matchZaimSnapshot(SNAPSHOT, aliasKeys("三菱UFJ銀行"))

        assert.deepEqual(result.matched.map((entry) => entry.name), ["三菱UFJ銀行"])
        assert.deepEqual(result.unmatched, [
            "SBI証券/eMAXIS Slim 全世界株式",
            "SBI証券/楽天VTI",
            "楽天証券/eMAXIS Slim 全世界株式",
            "楽天証券/楽天VTI",
            "SBI証券",
            "楽天証券",
        ])
    })

    it("残高一覧の名称で銀行等を対応付ける", () => {
        const result = matchZaimSnapshot(SNAPSHOT, aliasKeys("三菱UFJ銀行"))

        assert.deepEqual(
            result.matched.map((entry) => [entry.name, entry.amount]),
            [["三菱UFJ銀行", 1000]]
        )
    })

    it("aliasが1件も設定されていない場合はすべて未対応になる", () => {
        const result = matchZaimSnapshot(SNAPSHOT, [])

        assert.deepEqual(result.matched, [])
        assert.equal(result.unmatched.length, 7)
    })

    it("同一口座内の同名銘柄を出現順の接尾辞で個別に対応付ける", () => {
        const snapshot = snapshotOf(
            [{ name: "SBI証券", amount: 5000000 }],
            [
                { account: "SBI証券", name: "オルカン", amount: 3000000 },
                { account: "SBI証券", name: "オルカン", amount: 1200000 },
            ]
        )
        const result = matchZaimSnapshot(
            snapshot,
            aliasKeys("SBI証券/オルカン#1", "SBI証券/オルカン#2")
        )

        assert.deepEqual(
            result.matched.map((e) => [e.name, e.amount]),
            [
                ["SBI証券/オルカン#1", 3000000],
                ["SBI証券/オルカン#2", 1200000],
            ]
        )
        assert.deepEqual(result.unmatched, [])
    })

    it("出現順で一致した銘柄は口座単位・銘柄単位の合計に含めない", () => {
        const snapshot = snapshotOf(
            [],
            [
                { account: "SBI証券", name: "オルカン", amount: 3000000 },
                { account: "SBI証券", name: "オルカン", amount: 1200000 },
            ]
        )
        const result = matchZaimSnapshot(
            snapshot,
            aliasKeys("SBI証券/オルカン#1", "SBI証券/オルカン", "オルカン")
        )

        assert.deepEqual(
            result.matched.map((e) => [e.name, e.amount]),
            [["SBI証券/オルカン#1", 3000000]]
        )
        assert.deepEqual(result.unmatched, ["SBI証券/オルカン#2"])
    })

    it("同名行が1つだけなら接尾辞なしの表記で報告する", () => {
        const result = matchZaimSnapshot(SNAPSHOT, [])

        assert.ok(result.unmatched.includes("SBI証券/eMAXIS Slim 全世界株式"))
        assert.ok(!result.unmatched.some((name) => name.includes("#")))
    })

    it("同名行が複数ある場合は出現順つきの表記で報告する", () => {
        const snapshot = snapshotOf(
            [],
            [
                { account: "SBI証券", name: "オルカン", amount: 100 },
                { account: "SBI証券", name: "オルカン", amount: 200 },
            ]
        )
        const result = matchZaimSnapshot(snapshot, [])

        assert.deepEqual(result.unmatched, ["SBI証券/オルカン#1", "SBI証券/オルカン#2"])
    })
})
