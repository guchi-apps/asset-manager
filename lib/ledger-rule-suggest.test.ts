import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    attachSuggestionMatches,
    buildRuleSuggestMessage,
    buildRuleSuggestSchema,
    groupUnclassifiedLines,
    MAX_SUGGESTIONS,
    normalizeRuleSuggestions,
    requestRuleSuggestions,
    RuleSuggestError,
    type SuggestCategory,
    type UnclassifiedLine,
} from "./ledger-rule-suggest"
import { setAiUsageRecorder } from "./anthropic-messages"
import type { ClassificationRule } from "./ledger-rules"

/** スキーマの中を辿って確かめるための緩い型 */
type Loose = { [key: string]: Loose } & Record<string, unknown>

const categories: SuggestCategory[] = [
    { id: 10, label: "食費 / 食料品", kind: "EXPENSE" },
    { id: 11, label: "日用品", kind: "EXPENSE" },
    { id: 20, label: "その他収入 / ポイント", kind: "INCOME" },
]

function line(overrides: Partial<UnclassifiedLine>): UnclassifiedLine {
    return { kind: "EXPENSE", date: "2026-11-01", place: null, memo: null, name: null, amount: 1000, ...overrides }
}

describe("groupUnclassifiedLines", () => {
    it("種別・お店・メモ・品目名が同じ品目をまとめ、多い順に並べる（表記の全角・半角は同じとみなす）", () => {
        const groups = groupUnclassifiedLines([
            line({ place: "ＩＫＥＡ 鶴浜", date: "2026-11-03", amount: 3000 }),
            line({ place: "業務スーパー", date: "2026-11-02" }),
            line({ place: "業務スーパー", date: "2026-10-30" }),
            line({ place: "IKEA 鶴浜", date: "2026-10-01" }),
            line({ place: "業務スーパー", kind: "INCOME" }),
            line({ place: "業務スーパー", date: "2026-10-01" }),
        ])
        assert.deepEqual(
            groups.map((g) => [g.kind, g.place, g.count]),
            [
                ["EXPENSE", "業務スーパー", 3],
                ["EXPENSE", "ＩＫＥＡ 鶴浜", 2],
                ["INCOME", "業務スーパー", 1],
            ]
        )
        // 例はいちばん新しい品目（新しい順に渡す前提）
        assert.equal(groups[1].latestAmount, 3000)
        assert.equal(groups[1].latestDate, "2026-11-03")
    })
})

describe("buildRuleSuggestSchema", () => {
    it("null を許す id の enum は anyOf で書き、配列に maxItems を付けない（#397・#1041）", () => {
        const schema = buildRuleSuggestSchema([10, 11], [5]) as unknown as Loose
        const items = schema.properties.suggestions.items
        assert.equal(schema.properties.suggestions.maxItems, undefined)
        assert.deepEqual(items.properties.categoryId.anyOf, [{ type: "integer", enum: [10, 11] }, { type: "null" }])
        assert.deepEqual(items.properties.accountId.anyOf, [{ type: "integer", enum: [5] }, { type: "null" }])
        assert.ok(!Array.isArray(items.properties.categoryId.type))
        assert.deepEqual(items.required, ["field", "pattern", "target", "categoryId", "accountId", "reason"])
    })

    it("口座が無ければ accountId は null だけにする（空の enum を作らない）", () => {
        const schema = buildRuleSuggestSchema([10], []) as unknown as Loose
        assert.equal(schema.properties.suggestions.items.properties.accountId.type, "null")
        assert.equal(schema.properties.suggestions.items.properties.accountId.anyOf, undefined)
    })
})

describe("buildRuleSuggestMessage", () => {
    it("未分類のまとまり・今あるルール・分類先の候補を含める", () => {
        const text = buildRuleSuggestMessage({
            groups: groupUnclassifiedLines([line({ place: "業務スーパー", memo: "まとめ買い" })]),
            rules: [{ field: "MEMO", pattern: "給与", targetLabel: "給与" }],
            categories,
            accounts: [{ id: 5, name: "楽天証券" }],
        })
        assert.match(text, /支出 1件 \/ お店「業務スーパー」 \/ メモ「まとめ買い」/)
        assert.match(text, /メモ（MEMO）に「給与」→ 給与/)
        assert.match(text, /- 10: 食費 \/ 食料品/)
        assert.match(text, /- 20: その他収入 \/ ポイント/)
        assert.match(text, /- 5: 楽天証券/)
    })
})

describe("normalizeRuleSuggestions", () => {
    const options = { categories, accountIds: [5], existing: [{ field: "PLACE" as const, pattern: "ローソン" }] }

    it("採用できる提案だけを残す", () => {
        const result = normalizeRuleSuggestions(
            {
                suggestions: [
                    { field: "PLACE", pattern: "業務スーパー|イオン", target: "CATEGORY", categoryId: 10, accountId: null, reason: " スーパー " },
                    { field: "PLACE", pattern: "楽天証券", target: "TRANSFER_TO", categoryId: null, accountId: 5, reason: "積立" },
                    { field: "MEMO", pattern: "SBI", target: "TRANSFER_IN", categoryId: null, accountId: null, reason: "" },
                    // 存在しないカテゴリ・口座
                    { field: "PLACE", pattern: "A", target: "CATEGORY", categoryId: 999, accountId: null, reason: "" },
                    { field: "PLACE", pattern: "B", target: "TRANSFER_TO", categoryId: null, accountId: 999, reason: "" },
                    // 形が崩れたもの
                    { field: "OTHER", pattern: "C", target: "CATEGORY", categoryId: 10, accountId: null, reason: "" },
                    { field: "PLACE", pattern: " | ", target: "CATEGORY", categoryId: 10, accountId: null, reason: "" },
                    { field: "PLACE", pattern: "D", target: "UNKNOWN", categoryId: 10, accountId: null, reason: "" },
                    null,
                    // 今あるルールと同じ・提案どうしの重複（並び順・全角半角の違いは同じとみなす）
                    { field: "PLACE", pattern: "ローソン", target: "CATEGORY", categoryId: 10, accountId: null, reason: "" },
                    { field: "PLACE", pattern: "イオン|業務スーパー", target: "CATEGORY", categoryId: 11, accountId: null, reason: "" },
                ],
            },
            options
        )
        assert.deepEqual(
            result.map((r) => [r.field, r.pattern, r.target, r.categoryId, r.accountId, r.reason]),
            [
                ["PLACE", "業務スーパー|イオン", "CATEGORY", 10, null, "スーパー"],
                ["PLACE", "楽天証券", "TRANSFER_TO", null, 5, "積立"],
                ["MEMO", "SBI", "TRANSFER_IN", null, null, ""],
            ]
        )
    })

    it(`上限（${MAX_SUGGESTIONS}件）で切る・形が違えば空`, () => {
        const many = Array.from({ length: MAX_SUGGESTIONS + 5 }, (_, i) => ({
            field: "PLACE",
            pattern: `店${i}`,
            target: "CATEGORY",
            categoryId: 10,
            accountId: null,
            reason: "",
        }))
        assert.equal(normalizeRuleSuggestions({ suggestions: many }, options).length, MAX_SUGGESTIONS)
        assert.deepEqual(normalizeRuleSuggestions({}, options), [])
        assert.deepEqual(normalizeRuleSuggestions(null, options), [])
    })
})

describe("attachSuggestionMatches", () => {
    const groups = groupUnclassifiedLines([
        line({ place: "業務スーパー 高槻店" }),
        line({ place: "業務スーパー 茨木店" }),
        line({ place: "業務スーパー 茨木店" }),
        line({ place: "コンビニ", memo: "キャッシュバック", kind: "INCOME", amount: 500 }),
        line({ place: "ドラッグストア" }),
    ])
    const kindOf = (id: number) => categories.find((c) => c.id === id)?.kind ?? null
    const draft = (overrides: object) => ({
        field: "PLACE" as const,
        pattern: "",
        target: "CATEGORY" as const,
        categoryId: 10,
        accountId: null,
        reason: "",
        ...overrides,
    })

    it("当たる未分類の品目を数え、多い順に並べ、当たらない提案を捨てる", () => {
        const result = attachSuggestionMatches(
            [
                draft({ field: "MEMO", pattern: "キャッシュバック", categoryId: 20 }),
                draft({ pattern: "業務スーパー" }),
                draft({ pattern: "存在しない店" }),
                // 支出の品目に収入のカテゴリは当たらない
                draft({ pattern: "ドラッグ", categoryId: 20 }),
            ],
            groups,
            [],
            kindOf
        )
        assert.deepEqual(
            result.map((r) => [r.pattern, r.matches, r.samples.length]),
            [
                ["業務スーパー", 3, 2],
                ["キャッシュバック", 1, 1],
            ]
        )
        assert.equal(result[0].samples[0].count, 2)
    })

    it("今あるルールが先に当たる品目は数えない", () => {
        const existing: ClassificationRule = {
            id: 1,
            field: "PLACE",
            pattern: "茨木",
            target: "CATEGORY",
            categoryId: 11,
            categoryKind: "EXPENSE",
            accountId: null,
            order: 0,
        }
        const result = attachSuggestionMatches([draft({ pattern: "業務スーパー" })], groups, [existing], kindOf)
        assert.equal(result[0].matches, 1)
    })
})

describe("requestRuleSuggestions", () => {
    const originalFetch = globalThis.fetch
    afterEach(() => {
        globalThis.fetch = originalFetch
        setAiUsageRecorder(null)
    })
    const context = { groups: groupUnclassifiedLines([line({ place: "業務スーパー" })]), rules: [], categories, accounts: [] }

    it("構造化出力で呼び、応答を正規化して返す", async () => {
        setAiUsageRecorder(async () => {})
        let body: Loose = {} as Loose
        globalThis.fetch = (async (_url: string, init: RequestInit) => {
            body = JSON.parse(String(init.body))
            const text = JSON.stringify({
                suggestions: [{ field: "PLACE", pattern: "業務スーパー", target: "CATEGORY", categoryId: 10, accountId: null, reason: "スーパー" }],
            })
            return new Response(JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 })
        }) as typeof fetch
        const result = await requestRuleSuggestions("key", context)
        assert.equal(body.output_config.format.type, "json_schema")
        assert.equal(result.length, 1)
        assert.equal(result[0].pattern, "業務スーパー")
    })

    it("HTTPエラーは RuleSuggestError にする", async () => {
        setAiUsageRecorder(async () => {})
        globalThis.fetch = (async () => new Response("bad", { status: 429 })) as typeof fetch
        await assert.rejects(requestRuleSuggestions("key", context), (error: unknown) => {
            assert.ok(error instanceof RuleSuggestError)
            assert.match((error as Error).message, /利用制限/)
            return true
        })
    })
})
