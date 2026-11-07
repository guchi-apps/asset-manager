import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isExternalBalanceStale, matchExternalBalances, parseReconcileMode, planExternalReconciliation } from "./ledger-external-balance"

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

describe("planExternalReconciliation", () => {
    const accounts = [
        { id: 1, name: "VNEO 代表口座", kind: "BANK", purpose: "LIVING", balance: 146662, openingBalance: 0, openingDate: "2024-04-01" },
        { id: 2, name: "三井住友カード", kind: "CARD", purpose: null, balance: 238991, openingBalance: -10000, openingDate: "2024-04-01" },
        { id: 3, name: "財布", kind: "CASH", purpose: null, balance: -11979, openingBalance: 0, openingDate: null },
        { id: 4, name: "ICOCA", kind: "EMONEY", purpose: null, balance: 5008, openingBalance: 0, openingDate: "2024-04-01" },
    ]

    it("Zaimの残高と差がある口座だけを、差と、差を足した初期残高とともに返す", () => {
        const external = new Map([
            [1, { amount: 302675 }],
            [2, { amount: -184761 }],
            [4, { amount: 5008 }],
        ])
        assert.deepEqual(planExternalReconciliation(accounts, external), [
            {
                accountId: 1, name: "VNEO 代表口座", current: 146662, target: 302675, diff: 156013,
                openingBalance: 0, openingDate: "2024-04-01", newOpeningBalance: 156013,
            },
            {
                accountId: 2, name: "三井住友カード", current: 238991, target: -184761, diff: -423752,
                openingBalance: -10000, openingDate: "2024-04-01", newOpeningBalance: -433752,
            },
        ])
    })

    it("Zaimの残高が無い口座（現金など）は含めない", () => {
        assert.deepEqual(planExternalReconciliation(accounts, new Map()), [])
    })

    it("証券口座・用途が投資の口座は、差があっても含めない（#970）", () => {
        const invest = [
            { id: 5, name: "SBI 証券", kind: "SECURITIES", purpose: null, balance: 0, openingBalance: 0, openingDate: null },
            { id: 6, name: "確定拠出年金", kind: "OTHER", purpose: "INVESTMENT", balance: 0, openingBalance: 0, openingDate: null },
        ]
        const external = new Map([
            [5, { amount: 2870000 }],
            [6, { amount: 1200000 }],
        ])
        assert.deepEqual(planExternalReconciliation(invest, external), [])
    })
})

describe("parseReconcileMode", () => {
    it("既定は初期残高へ足す", () => {
        assert.equal(parseReconcileMode(undefined), "opening")
        assert.equal(parseReconcileMode("x"), "opening")
        assert.equal(parseReconcileMode("adjustment"), "adjustment")
    })
})
