import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    buildMigrationPlan,
    diffTotals,
    parseDump,
    toMinorUnits,
    totalsFromPlan,
    type Dump,
} from "./subscription-migration"

const T = new Date("2026-01-02T03:04:05.000Z")

function baseDump(): Dump {
    return {
        users: [{ id: "u1", email: "me@example.com" }],
        paymentMethods: [
            { id: "pm2", userId: "u1", name: "口座振替", displayOrder: 1, isActive: false, createdAt: T, updatedAt: T },
            { id: "pm1", userId: "u1", name: "楽天カード", displayOrder: 0, isActive: true, createdAt: T, updatedAt: T },
        ],
        labels: [
            { id: "l2", userId: "u1", name: "仕事用", color: "#60A5FA", createdAt: new Date("2026-02-01T00:00:00Z"), updatedAt: T },
            { id: "l1", userId: "u1", name: "動画配信", color: "#F87171", createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: T },
        ],
        subscriptions: [
            {
                id: "s1", userId: "u1", name: "Netflix", paymentMethodId: "pm1",
                startDate: "2025-04-01", endDate: null, autoRenew: true, memo: null, createdAt: T, updatedAt: T,
            },
        ],
        prices: [
            {
                id: "p2", subscriptionId: "s1", amount: 1590, currency: "JPY", billingCycle: "MONTHLY",
                billingInterval: 1, billingDay: 2, billingMonth: null, effectiveFrom: "2026-01-01", memo: "値上げ",
                createdAt: T, updatedAt: T,
            },
            {
                id: "p1", subscriptionId: "s1", amount: 990.5, currency: "JPY", billingCycle: "MONTHLY",
                billingInterval: 1, billingDay: 2, billingMonth: null, effectiveFrom: "2025-04-01", memo: null,
                createdAt: T, updatedAt: T,
            },
        ],
        labelLinks: [
            { subscriptionId: "s1", labelId: "l1" },
            { subscriptionId: "s1", labelId: "l2" },
        ],
    }
}

function errorsOf(dump: Dump, options?: { toEmail?: string }): string[] {
    const result = buildMigrationPlan(dump, options)
    assert.equal(result.ok, false)
    return result.ok ? [] : result.errors
}

describe("parseDump", () => {
    const line = (row: Record<string, unknown>) => JSON.stringify(row)

    it("reads every kind and accepts 0/1 and true/false booleans", () => {
        const text = [
            line({ kind: "user", id: "u1", email: "me@example.com" }),
            line({
                kind: "paymentMethod", id: "pm1", userId: "u1", name: "楽天カード", displayOrder: 0,
                isActive: 1, createdAt: "2026-01-02T03:04:05.000000Z", updatedAt: "2026-01-02T03:04:05.000000Z",
            }),
            line({
                kind: "subscription", id: "s1", userId: "u1", name: "Netflix", paymentMethodId: "pm1",
                startDate: "2025-04-01", endDate: null, autoRenew: false, memo: "a\nb",
                createdAt: "2026-01-02T03:04:05.000000Z", updatedAt: "2026-01-02T03:04:05.000000Z",
            }),
            line({
                kind: "price", id: "p1", subscriptionId: "s1", amount: "1590.00", currency: "JPY",
                billingCycle: "MONTHLY", billingInterval: 1, billingDay: 2, billingMonth: null,
                effectiveFrom: "2025-04-01", memo: null,
                createdAt: "2026-01-02T03:04:05.000000Z", updatedAt: "2026-01-02T03:04:05.000000Z",
            }),
            line({ kind: "labelLink", subscriptionId: "s1", labelId: "l1" }),
            "",
        ].join("\n")

        const result = parseDump(text)
        assert.equal(result.ok, true)
        if (!result.ok) return
        assert.equal(result.value.paymentMethods[0].isActive, true)
        assert.equal(result.value.subscriptions[0].autoRenew, false)
        assert.equal(result.value.subscriptions[0].memo, "a\nb")
        assert.equal(result.value.prices[0].amount, 1590)
        assert.deepEqual(result.value.labelLinks, [{ subscriptionId: "s1", labelId: "l1" }])
    })

    it("collects broken lines and unknown kinds instead of stopping at the first", () => {
        const result = parseDump(["{oops", line({ kind: "mystery", id: "x" }), line({ kind: "user", id: 1 })].join("\n"))
        assert.equal(result.ok, false)
        // 壊れた行・未知の kind に加え、user は id（数値）と email（欠落）の2項目が崩れている
        assert.equal(!result.ok && result.errors.length, 4)
    })
})

describe("buildMigrationPlan", () => {
    it("plans one user with orders, sorted prices and label links keyed by source id", () => {
        const result = buildMigrationPlan(baseDump())
        assert.equal(result.ok, true)
        if (!result.ok) return
        const [user] = result.value
        assert.equal(user.targetEmail, "me@example.com")
        assert.deepEqual(user.paymentMethods.map((pm) => [pm.name, pm.order]), [["楽天カード", 0], ["口座振替", 1]])
        // ラベルは作成順に 0 から振り直す
        assert.deepEqual(user.labels.map((label) => [label.name, label.order]), [["動画配信", 0], ["仕事用", 1]])
        const [sub] = user.subscriptions
        assert.deepEqual(sub.prices.map((p) => p.price.effectiveFrom), ["2025-04-01", "2026-01-01"])
        assert.equal(sub.paymentMethodSourceId, "pm1")
        assert.deepEqual(sub.labelSourceIds, ["l1", "l2"])
    })

    it("counts amounts per currency in minor units without float drift", () => {
        const dump = baseDump()
        dump.prices[0].amount = 0.1
        dump.prices[1].amount = 0.2
        const result = buildMigrationPlan(dump)
        assert.equal(result.ok, true)
        if (!result.ok) return
        const totals = totalsFromPlan(result.value[0])
        assert.equal(totals.amountMinorByCurrency.JPY, 30)
        assert.deepEqual(
            [totals.paymentMethods, totals.labels, totals.subscriptions, totals.prices, totals.labelLinks],
            [2, 2, 1, 2, 2]
        )
    })

    it("rejects a subscription without any price", () => {
        const dump = baseDump()
        dump.prices = []
        assert.match(errorsOf(dump).join("\n"), /料金が1件もありません/)
    })

    it("rejects two prices with the same effective date", () => {
        const dump = baseDump()
        dump.prices[1].effectiveFrom = dump.prices[0].effectiveFrom
        assert.match(errorsOf(dump).join("\n"), /適用開始日 2026-01-01 の料金が2件以上/)
    })

    it("rejects prices the app cannot represent", () => {
        const dump = baseDump()
        dump.prices[0].billingDay = 32
        dump.prices[1].billingCycle = "YEARLY" // billingMonth が無い
        assert.equal(errorsOf(dump).length, 2)
    })

    it("rejects an end date before the start date", () => {
        const dump = baseDump()
        dump.subscriptions[0].endDate = "2025-03-31"
        assert.match(errorsOf(dump).join("\n"), /契約終了日/)
    })

    it("rejects dangling and cross-user references", () => {
        const dump = baseDump()
        dump.subscriptions[0].paymentMethodId = "nope"
        dump.labelLinks.push({ subscriptionId: "s1", labelId: "ghost" })
        dump.prices.push({ ...dump.prices[0], id: "p9", subscriptionId: "ghost" })
        assert.equal(errorsOf(dump).length, 3)
    })

    it("refuses a payment method or label that belongs to another user", () => {
        const dump = baseDump()
        dump.users.push({ id: "u2", email: "other@example.com" })
        dump.paymentMethods[1].userId = "u2"
        dump.labels[0].userId = "u2"
        const messages = errorsOf(dump).join("\n")
        assert.match(messages, /別ユーザーの支払い方法/)
        assert.match(messages, /別ユーザーのラベル/)
    })

    it("refuses an empty dump and a missing user", () => {
        const empty = baseDump()
        empty.subscriptions = []
        empty.prices = []
        empty.labelLinks = []
        assert.match(errorsOf(empty).join("\n"), /サブスクが1件もありません/)

        const orphan = baseDump()
        orphan.users = []
        assert.match(errorsOf(orphan).join("\n"), /書き出しに含まれていません/)
    })

    it("overrides the target email only for a single source user", () => {
        const single = buildMigrationPlan(baseDump(), { toEmail: "new@example.com" })
        assert.equal(single.ok && single.value[0].targetEmail, "new@example.com")
        assert.equal(single.ok && single.value[0].sourceEmail, "me@example.com")

        const dump = baseDump()
        dump.users.push({ id: "u2", email: "other@example.com" })
        dump.labels.push({ id: "l3", userId: "u2", name: "x", color: "#F87171", createdAt: T, updatedAt: T })
        assert.match(errorsOf(dump, { toEmail: "new@example.com" }).join("\n"), /--to-email/)
    })

    it("ignores users that have no subscription data", () => {
        const dump = baseDump()
        dump.users.push({ id: "u2", email: "idle@example.com" })
        const result = buildMigrationPlan(dump)
        assert.equal(result.ok && result.value.length, 1)
    })
})

describe("totals", () => {
    it("converts to minor units and reports every mismatch", () => {
        assert.equal(toMinorUnits(990.5), 99050)
        const result = buildMigrationPlan(baseDump())
        assert.equal(result.ok, true)
        if (!result.ok) return
        const expected = totalsFromPlan(result.value[0])
        assert.deepEqual(diffTotals(expected, expected), [])

        const actual = structuredClone(expected)
        actual.prices += 1
        actual.amountMinorByCurrency.JPY += 1
        assert.equal(diffTotals(expected, actual).length, 2)
    })
})
