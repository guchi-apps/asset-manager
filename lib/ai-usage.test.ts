import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    AI_FEATURES,
    AI_FEATURE_LABELS,
    buildAiUsageResponse,
    extractUsageTokens,
    featureLabel,
    type AiUsageGroup,
} from "./ai-usage"

function group(overrides: Partial<AiUsageGroup> = {}): AiUsageGroup {
    return {
        feature: "receipt-image",
        model: "claude-opus-5",
        calls: 1,
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        ...overrides,
    }
}

/** ops-dashboard の `parseAiAppUsageResponse` が通す形（負でない安全な整数・空でない文字列）。 */
function assertAcceptedByOpsDashboard(data: unknown) {
    const features = (data as { features: unknown }).features
    assert.ok(Array.isArray(features))
    for (const row of features as Record<string, unknown>[]) {
        assert.ok(typeof row.label === "string" && row.label.length > 0)
        assert.ok(typeof row.model === "string" && row.model.length > 0)
        for (const key of ["last24h", "last7d"]) {
            const totals = row[key] as Record<string, unknown>
            for (const field of ["calls", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"]) {
                const value = totals[field]
                assert.ok(
                    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
                    `${key}.${field} must be a non-negative integer`
                )
            }
        }
    }
}

describe("extractUsageTokens", () => {
    it("maps the Anthropic usage fields without merging the cache into the input", () => {
        assert.deepEqual(
            extractUsageTokens({
                input_tokens: 1200,
                output_tokens: 340,
                cache_read_input_tokens: 50,
                cache_creation_input_tokens: 7,
            }),
            { inputTokens: 1200, outputTokens: 340, cacheReadTokens: 50, cacheWriteTokens: 7 }
        )
    })

    it("treats missing or malformed fields as 0 instead of dropping the call", () => {
        const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
        assert.deepEqual(extractUsageTokens(undefined), zero)
        assert.deepEqual(extractUsageTokens(null), zero)
        assert.deepEqual(
            extractUsageTokens({ input_tokens: "12", output_tokens: -5, cache_read_input_tokens: 1.5 }),
            zero
        )
        assert.deepEqual(extractUsageTokens({ output_tokens: 8 }), { ...zero, outputTokens: 8 })
    })
})

describe("featureLabel", () => {
    it("has a label for every feature", () => {
        for (const feature of AI_FEATURES) {
            assert.ok(AI_FEATURE_LABELS[feature].length > 0)
            assert.equal(featureLabel(feature), AI_FEATURE_LABELS[feature])
        }
    })

    it("falls back to the identifier for a feature that was removed from the code", () => {
        assert.equal(featureLabel("legacy-feature"), "legacy-feature")
    })
})

describe("buildAiUsageResponse", () => {
    it("returns an empty list when there were no calls", () => {
        assert.deepEqual(buildAiUsageResponse([], []), { features: [] })
    })

    it("joins the 24-hour and 7-day sums of the same feature and model into one row", () => {
        const result = buildAiUsageResponse(
            [group({ calls: 2, inputTokens: 300, outputTokens: 30, cacheReadTokens: 5, cacheWriteTokens: 1 })],
            [group({ calls: 9, inputTokens: 1500, outputTokens: 150, cacheReadTokens: 20, cacheWriteTokens: 4 })]
        )

        assert.deepEqual(result, {
            features: [
                {
                    label: "レシート画像の解析",
                    model: "claude-opus-5",
                    last24h: { calls: 2, inputTokens: 300, outputTokens: 30, cacheReadTokens: 5, cacheWriteTokens: 1 },
                    last7d: { calls: 9, inputTokens: 1500, outputTokens: 150, cacheReadTokens: 20, cacheWriteTokens: 4 },
                },
            ],
        })
    })

    it("fills the 24-hour side with 0 when the calls are all older than a day", () => {
        const result = buildAiUsageResponse([], [group({ calls: 4, inputTokens: 800, outputTokens: 80 })])

        assert.equal(result.features.length, 1)
        assert.deepEqual(result.features[0].last24h, {
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
        })
        assert.equal(result.features[0].last7d.calls, 4)
        assertAcceptedByOpsDashboard(result)
    })

    it("uses the 24-hour sum for the 7-day side if the wider window is missing the row", () => {
        const result = buildAiUsageResponse([group({ calls: 3, inputTokens: 500 })], [])
        assert.equal(result.features[0].last7d.calls, 3)
        assert.equal(result.features[0].last7d.inputTokens, 500)
    })

    it("splits a feature into one row per model when the model was switched", () => {
        const result = buildAiUsageResponse(
            [group({ model: "claude-opus-5" })],
            [group({ model: "claude-opus-5", calls: 5 }), group({ model: "claude-sonnet-5", calls: 7 })]
        )

        assert.deepEqual(
            result.features.map((row) => [row.label, row.model, row.last24h.calls, row.last7d.calls]),
            [
                ["レシート画像の解析", "claude-opus-5", 1, 5],
                ["レシート画像の解析", "claude-sonnet-5", 0, 7],
            ]
        )
    })

    it("keeps the rows in a stable order regardless of the input order", () => {
        const a = group({ feature: "rebalance-advice" })
        const b = group({ feature: "receipt-classify" })
        const c = group({ feature: "receipt-image" })

        const first = buildAiUsageResponse([], [a, b, c])
        const second = buildAiUsageResponse([], [c, a, b])
        assert.deepEqual(first, second)
    })

    it("only exposes counts and token numbers", () => {
        const result = buildAiUsageResponse([group()], [group()])
        assert.deepEqual(Object.keys(result), ["features"])
        assert.deepEqual(Object.keys(result.features[0]).sort(), ["label", "last24h", "last7d", "model"])
        assert.deepEqual(Object.keys(result.features[0].last24h).sort(), [
            "cacheReadTokens",
            "cacheWriteTokens",
            "calls",
            "inputTokens",
            "outputTokens",
        ])
    })
})
