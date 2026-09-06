import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    ADVICE_VERDICTS,
    ageFromBirthYear,
    buildAdviceMessages,
    buildAdviceSchema,
    buildContextText,
    describeProfile,
    normalizeAdvice,
    normalizeAllocationSuggestion,
    parseAdviceResponse,
    requestRebalanceAdvice,
    RebalanceAdviceError,
    DEFAULT_ADVICE_MODEL,
    type RebalanceAdviceContext,
} from "./rebalance-advice"
import { ANTHROPIC_API_URL } from "./anthropic-messages"

const rows = [
    { key: "category:1", id: 1, name: "全世界株式", targetRatio: 40, isUnassigned: false, isExcluded: false },
    { key: "category:2", id: 2, name: "先進国債券", targetRatio: 15, isUnassigned: false, isExcluded: false },
    { key: "category:3", id: 3, name: "現金", targetRatio: null, isUnassigned: false, isExcluded: false },
    { key: "category:9", id: 9, name: "生活防衛費", targetRatio: null, isUnassigned: false, isExcluded: true },
    { key: "unassigned", id: null, name: "未分類", targetRatio: null, isUnassigned: true, isExcluded: false },
]

function sampleContext(overrides: Partial<RebalanceAdviceContext> = {}): RebalanceAdviceContext {
    return {
        axisLabel: "カテゴリ別",
        today: "2026-09-06",
        totalValue: 12_480_000,
        excludedValue: 500_000,
        excludedCount: 1,
        threshold: 5,
        rows: [
            {
                key: "category:1",
                name: "全世界株式",
                currentValue: 5_316_000,
                currentRatio: 42.6,
                targetRatio: 40,
                driftPt: 2.6,
                diffValue: -324_000,
                isExcluded: false,
                isUnassigned: false,
                kind: "investment",
                change: { amount: 195_000, rate: 3.8, days: 27 },
            },
            {
                key: "category:2",
                name: "先進国債券",
                currentValue: 1_011_000,
                currentRatio: 8.1,
                targetRatio: 15,
                driftPt: -6.9,
                diffValue: 861_000,
                isExcluded: false,
                isUnassigned: false,
                kind: "investment",
                change: null,
            },
            {
                key: "category:9",
                name: "生活防衛費",
                currentValue: 500_000,
                currentRatio: 3.9,
                targetRatio: null,
                driftPt: null,
                diffValue: null,
                isExcluded: true,
                isUnassigned: false,
                kind: "cash",
                change: null,
            },
        ],
        proposal: {
            mode: "buyOnly",
            extraAmount: 300_000,
            items: [{ name: "先進国債券", amount: 300_000 }],
            maxDriftBefore: 6.9,
            maxDriftAfter: 4.7,
            shortfallTotal: 861_000,
        },
        monthlyDeposit: 100_000,
        profile: { birthYear: 1981, retirementAge: 65, riskTolerance: "medium", investmentNote: null },
        ...overrides,
    }
}

describe("buildContextText", () => {
    it("値動きを何日ぶんかと一緒に書き、無い行は不明と書く", () => {
        const text = buildContextText(sampleContext())
        assert.match(text, /全世界株式（key: category:1）/)
        assert.match(text, /\+195,000円（\+3\.8%・27日ぶん）/)
        assert.match(text, /先進国債券.*値動き: 不明/)
        assert.match(text, /比べられる記録との差を何日ぶんかを添えて/)
    })

    it("しきい値以上の項目と対象外の項目を分けて書く", () => {
        const text = buildContextText(sampleContext())
        assert.match(text, /しきい値以上の項目: 先進国債券/)
        assert.match(text, /## 計算から外している項目\n- 生活防衛費/)
        assert.match(text, /対象外 1件・500,000円/)
    })

    it("提案と投資プロフィールを書く", () => {
        const text = buildContextText(sampleContext())
        assert.match(text, /買い増しのみ/)
        assert.match(text, /先進国債券 \+300,000円/)
        assert.match(text, /不足額）: 861,000円/)
        assert.match(text, /- 毎月の積立: 100,000円/)
        assert.match(text, /リスク許容度: 中/)
    })
})

describe("describeProfile / ageFromBirthYear", () => {
    it("未登録の項目はそう書き、積立が無ければ登録なしと書く", () => {
        const text = describeProfile(
            { birthYear: null, retirementAge: null, riskTolerance: null, investmentNote: "  住宅を買う予定 " },
            null,
            new Date("2026-09-06T00:00:00Z")
        )
        assert.match(text, /年齢: 未登録/)
        assert.match(text, /リタイア予定: 未登録/)
        assert.match(text, /リスク許容度: 未登録/)
        assert.match(text, /毎月の積立: 登録なし/)
        assert.match(text, /本人の補足: 住宅を買う予定/)
    })

    it("年齢とリタイアまでの年数を出す", () => {
        const now = new Date("2026-09-06T00:00:00Z")
        assert.equal(ageFromBirthYear(1981, now), 45)
        assert.equal(ageFromBirthYear(null, now), null)
        const text = describeProfile(
            { birthYear: 1981, retirementAge: 65, riskTolerance: "high", investmentNote: null },
            50_000,
            now
        )
        assert.match(text, /45歳（1981年生まれ）/)
        assert.match(text, /リタイア予定: 65歳（あと20年）/)
    })
})

describe("buildAdviceSchema", () => {
    it("目標を設定できる行を全部 required にした配分オブジェクトを要求する", () => {
        const schema = buildAdviceSchema([
            { key: "category:1", name: "全世界株式" },
            { key: "category:2", name: "先進国債券" },
        ]) as { properties: { allocation: { properties: { ratios: { required: string[] } } } } }
        assert.deepEqual(schema.properties.allocation.properties.ratios.required, ["category:1", "category:2"])
    })

    it("設定できる行が無ければ配分は null 固定になる", () => {
        const schema = buildAdviceSchema([]) as { properties: { allocation: { type: string } } }
        assert.equal(schema.properties.allocation.type, "null")
    })
})

describe("normalizeAllocationSuggestion", () => {
    it("未分類・対象外・知らない key を落とし、目標を設定できる行の集合へ射影する", () => {
        const result = normalizeAllocationSuggestion(
            {
                basis: "45歳・リスク許容度 中",
                ratios: {
                    "category:1": { ratio: 55, reason: "株式が主役" },
                    "category:2": { ratio: 25, reason: "下支え" },
                    "category:3": { ratio: 20, reason: "生活費半年分" },
                    "category:9": { ratio: 30, reason: "対象外なのに返してきた" },
                    unassigned: { ratio: 10, reason: "未分類" },
                    "category:404": { ratio: 5, reason: "存在しない" },
                },
            },
            rows
        )
        assert.ok(result)
        assert.deepEqual(
            result.items.map((item) => [item.key, item.ratio, item.currentTarget]),
            [
                ["category:1", 55, 40],
                ["category:2", 25, 15],
                ["category:3", 20, null],
            ]
        )
        assert.equal(result.basis, "45歳・リスク許容度 中")
    })

    it("提案に無い行は今の目標を残し、合計100からのズレは最大の行で吸収する", () => {
        const result = normalizeAllocationSuggestion(
            { basis: "", ratios: { "category:1": { ratio: 50.04, reason: "" } } },
            rows
        )
        assert.ok(result)
        // category:2 は既存の15、category:3 は目標なしなので0。合計65 → 差35を最大の行へ
        assert.deepEqual(
            result.items.map((item) => [item.key, item.ratio]),
            [
                ["category:1", 85],
                ["category:2", 15],
                ["category:3", 0],
            ]
        )
    })

    it("設定できる行が無い・合計が0・null は null になる", () => {
        assert.equal(normalizeAllocationSuggestion(null, rows), null)
        assert.equal(normalizeAllocationSuggestion({ ratios: {} }, [rows[4]]), null)
        assert.equal(
            normalizeAllocationSuggestion(
                { ratios: { "category:1": { ratio: 0 }, "category:2": { ratio: 0 }, "category:3": { ratio: 0 } } },
                rows.map((row) => ({ ...row, targetRatio: null }))
            ),
            null
        )
    })
})

describe("normalizeAdvice / parseAdviceResponse", () => {
    it("不正な verdict は undecided に、質問は3件までに丸める", () => {
        const advice = normalizeAdvice(
            {
                verdict: "whatever",
                verdictLabel: "  見送り  ",
                headline: "様子見",
                reasons: [{ title: "a", detail: "b" }, { title: "", detail: "" }],
                cautions: "not an array",
                allocation: null,
                questions: ["q1", "", "q2", "q3", "q4"],
            },
            rows
        )
        assert.equal(advice.verdict, "undecided")
        assert.equal(advice.verdictLabel, "見送り")
        assert.deepEqual(advice.reasons, [{ title: "a", detail: "b" }])
        assert.deepEqual(advice.cautions, [])
        assert.equal(advice.allocation, null)
        assert.deepEqual(advice.questions, ["q1", "q2", "q3"])
        assert.ok((ADVICE_VERDICTS as readonly string[]).includes(advice.verdict))
    })

    it("拒否・空応答・壊れたJSONは RebalanceAdviceError", () => {
        assert.throws(() => parseAdviceResponse({ stop_reason: "refusal" }, rows), RebalanceAdviceError)
        assert.throws(() => parseAdviceResponse({ content: [] }, rows), RebalanceAdviceError)
        assert.throws(
            () => parseAdviceResponse({ content: [{ type: "text", text: "{oops" }] }, rows),
            RebalanceAdviceError
        )
    })
})

describe("buildAdviceMessages", () => {
    it("最初の呼び出しは文脈だけを user で送る", () => {
        const messages = buildAdviceMessages({ context: sampleContext(), turns: [] })
        assert.equal(messages.length, 1)
        assert.equal(messages[0].role, "user")
        assert.match(messages[0].content, /## 項目ごとの状況/)
    })

    it("履歴のあとに追記を user で足し、必ず user で終わる", () => {
        const messages = buildAdviceMessages({
            context: sampleContext(),
            turns: [
                { role: "assistant", content: '{"verdict":"partial"}' },
                { role: "user", content: "NISAです" },
                { role: "assistant", content: '{"verdict":"act"}' },
            ],
            message: "積立は月10万円",
        })
        assert.deepEqual(
            messages.map((m) => m.role),
            ["user", "assistant", "user", "assistant", "user"]
        )
        assert.match(messages[4].content, /積立は月10万円/)

        const withoutMessage = buildAdviceMessages({
            context: sampleContext(),
            turns: [{ role: "assistant", content: "{}" }],
        })
        assert.equal(withoutMessage[withoutMessage.length - 1].role, "user")
    })
})

describe("requestRebalanceAdvice", () => {
    async function withStubbedFetch(
        handler: (url: string, init: RequestInit) => Response,
        run: () => Promise<void>
    ) {
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
            handler(String(input), init ?? {})) as typeof fetch
        try {
            await run()
        } finally {
            globalThis.fetch = originalFetch
        }
    }

    it("構造化出力のスキーマと履歴を送り、応答を行の集合へ射影して返す", async () => {
        let capturedUrl = ""
        let body: Record<string, unknown> = {}
        let headers: Record<string, string> = {}

        await withStubbedFetch(
            (url, init) => {
                capturedUrl = url
                headers = init.headers as Record<string, string>
                body = JSON.parse(String(init.body))
                return new Response(
                    JSON.stringify({
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    verdict: "partial",
                                    verdictLabel: "買い増しで寄せる",
                                    headline: "債券だけがしきい値超え",
                                    reasons: [],
                                    cautions: [],
                                    allocation: {
                                        basis: "45歳",
                                        ratios: {
                                            "category:1": { ratio: 50, reason: "" },
                                            "category:2": { ratio: 30, reason: "" },
                                            "category:3": { ratio: 20, reason: "" },
                                        },
                                    },
                                    questions: ["NISAですか？"],
                                }),
                            },
                        ],
                    }),
                    { status: 200 }
                )
            },
            async () => {
                const advice = await requestRebalanceAdvice({
                    apiKey: "test-key",
                    context: sampleContext(),
                    rows,
                    turns: [],
                })
                assert.equal(advice.verdict, "partial")
                assert.deepEqual(
                    advice.allocation?.items.map((item) => [item.key, item.ratio]),
                    [
                        ["category:1", 50],
                        ["category:2", 30],
                        ["category:3", 20],
                    ]
                )
            }
        )

        assert.equal(capturedUrl, ANTHROPIC_API_URL)
        assert.equal(headers["x-api-key"], "test-key")
        assert.equal(body.model, DEFAULT_ADVICE_MODEL)
        const format = (body.output_config as { format: { type: string; schema: { properties: { allocation: { properties: { ratios: { required: string[] } } } } } } }).format
        assert.equal(format.type, "json_schema")
        assert.deepEqual(format.schema.properties.allocation.properties.ratios.required, [
            "category:1",
            "category:2",
            "category:3",
        ])
    })

    it("HTTPエラーは利用者向けの文言に変換する", async () => {
        await withStubbedFetch(
            () => new Response("rate limited", { status: 429 }),
            async () => {
                await assert.rejects(
                    requestRebalanceAdvice({ apiKey: "k", context: sampleContext(), rows, turns: [] }),
                    (error: unknown) =>
                        error instanceof RebalanceAdviceError && /利用制限/.test(error.message)
                )
            }
        )
        await withStubbedFetch(
            () => new Response("boom", { status: 500 }),
            async () => {
                await assert.rejects(
                    requestRebalanceAdvice({ apiKey: "k", context: sampleContext(), rows, turns: [] }),
                    (error: unknown) =>
                        error instanceof RebalanceAdviceError && /AIの呼び出しに失敗しました \(HTTP 500\)/.test(error.message)
                )
            }
        )
    })
})
