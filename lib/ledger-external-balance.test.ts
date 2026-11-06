import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isExternalBalanceStale, matchExternalBalances } from "./ledger-external-balance"

const card = { id: 1, name: "三井住友カード", hasStatementFeed: true }
const bank = { id: 2, name: "住信SBIネット銀行", hasStatementFeed: true }
const cash = { id: 3, name: "財布", hasStatementFeed: false }

describe("matchExternalBalances", () => {
    it("口座名の対応で対応付けたZaimの口座名の残高を使う", () => {
        const result = matchExternalBalances(
            [card],
            [{ externalName: "三井住友カード VISA", accountId: 1 }],
            [{ name: "三井住友カード VISA", amount: -184591, lastUpdatedAt: "2026-11-06T02:00:00Z" }]
        )
        assert.deepEqual(result.get(1), { accountId: 1, zaimName: "三井住友カード VISA", amount: -184591, lastUpdatedAt: "2026-11-06T02:00:00Z" })
    })

    it("対応が無くても、口座の名前が同じなら使う", () => {
        const result = matchExternalBalances([bank], [], [{ name: "住信SBIネット銀行", amount: 120000, lastUpdatedAt: null }])
        assert.equal(result.get(2)?.amount, 120000)
    })

    it("明細が届かない口座には使わない", () => {
        const result = matchExternalBalances([cash], [{ externalName: "財布", accountId: 3 }], [{ name: "財布", amount: 5000, lastUpdatedAt: null }])
        assert.equal(result.size, 0)
    })

    it("候補の残高が2つ以上あれば決められないので使わない", () => {
        const result = matchExternalBalances(
            [card],
            [{ externalName: "VISA", accountId: 1 }],
            [
                { name: "三井住友カード", amount: -1, lastUpdatedAt: null },
                { name: "VISA", amount: -2, lastUpdatedAt: null },
            ]
        )
        assert.equal(result.size, 0)
    })

    it("1つの残高が2つの口座の候補になったら、どちらにも使わない", () => {
        const result = matchExternalBalances(
            [card, bank],
            [
                { externalName: "共通", accountId: 1 },
                { externalName: "共通", accountId: 2 },
            ],
            [{ name: "共通", amount: 100, lastUpdatedAt: null }]
        )
        assert.equal(result.size, 0)
    })

    it("ほかの口座へ対応付けた名前は候補にしない", () => {
        const result = matchExternalBalances(
            [card, bank],
            [{ externalName: "三井住友カード VISA", accountId: 1 }],
            [{ name: "三井住友カード VISA", amount: -10, lastUpdatedAt: null }]
        )
        assert.equal(result.has(2), false)
        assert.equal(result.get(1)?.amount, -10)
    })
})

describe("isExternalBalanceStale", () => {
    const now = new Date("2026-11-06T12:00:00Z")
    it("3日以上前は古い", () => {
        assert.equal(isExternalBalanceStale("2026-11-03T12:00:00Z", now), true)
        assert.equal(isExternalBalanceStale("2026-11-04T12:00:00Z", now), false)
    })
    it("時刻が無い・読めないものは古いとしない", () => {
        assert.equal(isExternalBalanceStale(null, now), false)
        assert.equal(isExternalBalanceStale("x", now), false)
    })
})
