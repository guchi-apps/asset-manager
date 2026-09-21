import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    AnthropicRequestError,
    requestAnthropicMessage,
    setAiUsageRecorder,
    type AiUsageRecorder,
} from "./anthropic-messages"
import type { AiUsageRecord } from "./ai-usage"

async function withStubbedFetch(response: () => Response, run: () => Promise<void>) {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => response()) as typeof fetch
    try {
        await run()
    } finally {
        setAiUsageRecorder(null)
        globalThis.fetch = originalFetch
    }
}

const okResponse = () =>
    new Response(
        JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            content: [{ type: "text", text: "{}" }],
            usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 3 },
        }),
        { status: 200 }
    )

describe("requestAnthropicMessage usage recording", () => {
    it("records the model the API answered with, not the one that was asked for", async () => {
        const recorded: AiUsageRecord[] = []
        setAiUsageRecorder(async (record) => {
            recorded.push(record)
        })

        await withStubbedFetch(okResponse, async () => {
            await requestAnthropicMessage("key", { model: "claude-haiku-4-5" }, {
                label: "test",
                feature: "receipt-classify",
            })
        })

        assert.deepEqual(recorded, [
            {
                feature: "receipt-classify",
                model: "claude-haiku-4-5-20251001",
                inputTokens: 10,
                outputTokens: 2,
                cacheReadTokens: 3,
                cacheWriteTokens: 0,
            },
        ])
    })

    it("falls back to the requested model, then to 'unknown', when the response has no model", async () => {
        const recorded: AiUsageRecord[] = []
        setAiUsageRecorder(async (record) => {
            recorded.push(record)
        })

        await withStubbedFetch(
            () => new Response(JSON.stringify({ content: [] }), { status: 200 }),
            async () => {
                await requestAnthropicMessage("key", { model: "claude-opus-5" }, { label: "t", feature: "receipt-mail" })
                await requestAnthropicMessage("key", {}, { label: "t", feature: "receipt-mail" })
            }
        )

        assert.deepEqual(
            recorded.map((record) => [record.model, record.inputTokens, record.outputTokens]),
            [
                ["claude-opus-5", 0, 0],
                ["unknown", 0, 0],
            ]
        )
    })

    it("does not record a call that failed with an HTTP error", async () => {
        let calls = 0
        const recorder: AiUsageRecorder = async () => {
            calls += 1
        }
        setAiUsageRecorder(recorder)
        const originalError = console.error
        console.error = () => {}

        try {
            await withStubbedFetch(
                () => new Response("overloaded", { status: 529 }),
                async () => {
                    await assert.rejects(
                        () => requestAnthropicMessage("key", { model: "m" }, { label: "t", feature: "receipt-image" }),
                        AnthropicRequestError
                    )
                }
            )
        } finally {
            console.error = originalError
        }

        assert.equal(calls, 0)
    })

    it("still returns the AI result when the usage cannot be saved", async () => {
        setAiUsageRecorder(async () => {
            throw new Error("database is down")
        })
        const originalError = console.error
        const logged: unknown[][] = []
        console.error = (...args: unknown[]) => {
            logged.push(args)
        }

        try {
            await withStubbedFetch(okResponse, async () => {
                const result = await requestAnthropicMessage(
                    "key",
                    { model: "claude-haiku-4-5" },
                    { label: "t", feature: "rebalance-advice" }
                )
                assert.equal(result.content?.[0]?.text, "{}")
            })
        } finally {
            console.error = originalError
        }

        assert.equal(logged.length, 1)
        assert.match(String(logged[0][0]), /AI usage log failed/)
    })
})
