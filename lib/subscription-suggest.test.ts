import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { suggestSubscriptions, suggestionKey, type SuggestContext, type SuggestEntry } from "@/lib/subscription-suggest"

let nextId = 1
function entry(date: string, amount: number, name: string, accountId: number | null = 1): SuggestEntry {
    return { id: nextId++, date, amount, name, accountId, accountName: accountId ? `口座${accountId}` : null }
}

const context = (overrides: Partial<SuggestContext> = {}): SuggestContext => ({
    today: "2026-11-20",
    subscriptionNames: [],
    linkedNames: [],
    dismissedKeys: [],
    ...overrides,
})

describe("suggestSubscriptions", () => {
    it("同じ金額で毎月続く支払いを毎月の候補にする", () => {
        const entries = [
            entry("2026-08-18", 980, "SPOTIFY"),
            entry("2026-09-17", 980, "SPOTIFY"),
            entry("2026-10-18", 980, "SPOTIFY"),
            entry("2026-11-18", 980, "SPOTIFY", 2),
        ]
        const [suggestion, ...rest] = suggestSubscriptions(entries, context())
        assert.equal(rest.length, 0)
        assert.equal(suggestion.cycle, "MONTHLY")
        assert.equal(suggestion.amount, 980)
        assert.equal(suggestion.fixedAmount, true)
        assert.equal(suggestion.billingDay, 18)
        assert.equal(suggestion.billingMonth, null)
        assert.equal(suggestion.startDate, "2026-08-18")
        assert.equal(suggestion.lastDate, "2026-11-18")
        assert.equal(suggestion.accountId, 2)
        assert.deepEqual(
            suggestion.occurrences.map((o) => o.date),
            ["2026-11-18", "2026-10-18", "2026-09-17", "2026-08-18"]
        )
    })

    it("2回しか無ければ毎月の候補にしない", () => {
        const entries = [entry("2026-10-18", 980, "SPOTIFY"), entry("2026-11-18", 980, "SPOTIFY")]
        assert.deepEqual(suggestSubscriptions(entries, context()), [])
    })

    it("金額が変動する公共料金は中央値で候補にする", () => {
        const entries = [
            entry("2026-07-25", 6950, "関西電力"),
            entry("2026-08-25", 9120, "関西電力"),
            entry("2026-09-25", 8800, "関西電力"),
            entry("2026-10-27", 7400, "関西電力"),
        ]
        const [suggestion] = suggestSubscriptions(entries, context())
        assert.equal(suggestion.fixedAmount, false)
        assert.equal(suggestion.minAmount, 6950)
        assert.equal(suggestion.maxAmount, 9120)
        assert.equal(suggestion.amount, 8100)
        assert.equal(suggestion.billingDay, 25)
    })

    it("季節で金額が大きく動く電気代も、毎月なら候補にする", () => {
        const entries = [
            entry("2026-07-25", 11200, "関西電力"),
            entry("2026-08-25", 13800, "関西電力"),
            entry("2026-09-25", 6100, "関西電力"),
            entry("2026-10-27", 3900, "関西電力"),
        ]
        const [suggestion, ...rest] = suggestSubscriptions(entries, context())
        assert.equal(rest.length, 0)
        assert.equal(suggestion.cycle, "MONTHLY")
        assert.equal(suggestion.interval, 1)
        assert.equal(suggestion.fixedAmount, false)
        assert.equal(suggestion.minAmount, 3900)
        assert.equal(suggestion.maxAmount, 13800)
    })

    it("金額が大きく動く並びでも、3回では候補にしない", () => {
        const entries = [entry("2026-08-25", 13800, "関西電力"), entry("2026-09-25", 6100, "関西電力"), entry("2026-10-27", 3900, "関西電力")]
        assert.deepEqual(suggestSubscriptions(entries, context()), [])
    })

    it("2か月ごとに払う水道料金を、2か月ごとの候補にする", () => {
        const entries = [
            entry("2026-03-12", 4210, "大阪市水道局"),
            entry("2026-05-13", 4580, "大阪市水道局"),
            entry("2026-07-13", 5120, "大阪市水道局"),
            entry("2026-09-14", 4890, "大阪市水道局"),
        ]
        const [suggestion, ...rest] = suggestSubscriptions(entries, context())
        assert.equal(rest.length, 0)
        assert.equal(suggestion.cycle, "MONTHLY")
        assert.equal(suggestion.interval, 2)
        assert.equal(suggestion.billingDay, 13)
        assert.equal(suggestion.amount, 4735)
        assert.equal(suggestion.monthlyAmount, 2368)
    })

    it("2か月ごとの水道料金でも、最後の支払いから間が空きすぎたら候補にしない", () => {
        const entries = [entry("2026-01-12", 4210, "大阪市水道局"), entry("2026-03-13", 4580, "大阪市水道局"), entry("2026-05-13", 5120, "大阪市水道局")]
        assert.deepEqual(suggestSubscriptions(entries, context()), [])
    })

    it("金額の違う別契約が同じ日に並ぶだけなら、束に分けない見方で混ぜない", () => {
        const entries = ["2026-09-05", "2026-10-05", "2026-11-05"].flatMap((d) => [
            entry(d, 130, "APPLE.COM/BILL"),
            entry(d, 1450, "APPLE.COM/BILL"),
        ])
        // 各契約は3回ずつ。束ごとに毎月の候補になり、1本の並びとして混ざった候補は出ない
        assert.deepEqual(
            suggestSubscriptions(entries, context()).map((s) => s.amount),
            [1450, 130]
        )
    })

    it("月に何度も払うお店は候補にしない", () => {
        const entries = ["2026-09-02", "2026-09-10", "2026-09-21", "2026-10-03", "2026-10-15", "2026-10-29", "2026-11-08"].map((d) =>
            entry(d, 3200, "ライフ")
        )
        assert.deepEqual(suggestSubscriptions(entries, context()), [])
    })

    it("同じお店でも金額の違う契約は別の候補に分ける", () => {
        const entries = ["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"].flatMap((d) => [
            entry(d, 130, "APPLE.COM/BILL"),
            entry(d, 1450, "APPLE.COM/BILL"),
        ])
        const suggestions = suggestSubscriptions(entries, context())
        assert.deepEqual(
            suggestions.map((s) => s.amount),
            [1450, 130]
        )
        assert.equal(suggestions[0].key, suggestions[1].key)
        assert.notEqual(suggestions[0].id, suggestions[1].id)
    })

    it("最後の支払いから1周期と猶予を過ぎたら終わった契約とみなす", () => {
        const entries = [entry("2026-05-10", 1200, "ジム"), entry("2026-06-10", 1200, "ジム"), entry("2026-07-10", 1200, "ジム")]
        assert.deepEqual(suggestSubscriptions(entries, context()), [])
    })

    it("毎年の支払いを毎年の候補にする", () => {
        const entries = [entry("2025-06-03", 5900, "AMAZON PRIME"), entry("2026-06-02", 5900, "AMAZON PRIME")]
        const [suggestion] = suggestSubscriptions(entries, context())
        assert.equal(suggestion.cycle, "YEARLY")
        assert.equal(suggestion.billingDay, 2)
        assert.equal(suggestion.billingMonth, 6)
        assert.equal(suggestion.monthlyAmount, 492)
    })

    it("登録済みの定期払い・紐付け済みのお店・却下したお店は候補にしない", () => {
        const entries = ["2026-09-05", "2026-10-05", "2026-11-05"].flatMap((d) => [
            entry(d, 1590, "NETFLIX.COM"),
            entry(d, 4400, "ドコモご利用料金"),
            entry(d, 500, "ＤＡＺＮ"),
        ])
        const suggestions = suggestSubscriptions(
            entries,
            context({ subscriptionNames: ["Netflix"], linkedNames: ["ドコモご利用料金"], dismissedKeys: [suggestionKey("DAZN")!] })
        )
        assert.deepEqual(suggestions, [])
    })

    it("返金（0円以下）と未来日の明細は数えない", () => {
        const entries = [
            entry("2026-09-05", 1000, "Hulu"),
            entry("2026-10-05", -1000, "Hulu"),
            entry("2026-11-05", 1000, "Hulu"),
            entry("2026-12-05", 1000, "Hulu"),
        ]
        assert.deepEqual(suggestSubscriptions(entries, context()), [])
    })

    it("月あたりの金額が大きい順に並べる", () => {
        const entries = ["2026-09-05", "2026-10-05", "2026-11-05"].flatMap((d) => [entry(d, 500, "A店"), entry(d, 3000, "B店")])
        assert.deepEqual(
            suggestSubscriptions(entries, context()).map((s) => s.name),
            ["B店", "A店"]
        )
    })
})
