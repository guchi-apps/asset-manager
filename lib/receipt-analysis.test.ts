import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    ANTHROPIC_API_URL,
    ANTHROPIC_API_VERSION,
    DEFAULT_RECEIPT_MODEL,
    ReceiptAnalysisError,
    analyzeReceiptImage,
    buildCategoryGuide,
    buildCategoryIdProperty,
    isSupportedImageMimeType,
    normalizeAiClassifiedItems,
    normalizeCategoryCandidates,
    normalizeAnalyzedReceipt,
    parseAnalysisResponse,
    parseClassificationResponse,
} from "./receipt-analysis"
import { setAiUsageRecorder } from "./anthropic-messages"
import type { AiUsageRecord } from "./ai-usage"

describe("isSupportedImageMimeType", () => {
    it("accepts the formats Claude can read", () => {
        assert.equal(isSupportedImageMimeType("image/jpeg"), true)
        assert.equal(isSupportedImageMimeType("image/heic"), false)
        assert.equal(isSupportedImageMimeType("application/pdf"), false)
    })
})

describe("normalizeAnalyzedReceipt", () => {
    it("keeps a well-formed result as-is", () => {
        const result = normalizeAnalyzedReceipt({
            storeName: "イオン 西新井店",
            purchasedAt: "2026-08-20T18:30",
            totalAmount: 1000,
            taxAmount: 80,
            discountAmount: 50,
            taxIncludedInItems: true,
            confidence: 0.94,
            items: [
                {
                    rawName: "牛乳",
                    quantity: 2,
                    unitPrice: 150,
                    amount: 300,
                    discount: 0,
                    ledgerCategoryId: 11,
                    confidence: 0.9,
                },
            ],
        })

        assert.equal(result.storeName, "イオン 西新井店")
        assert.equal(result.totalAmount, 1000)
        assert.equal(result.items.length, 1)
        assert.equal(result.items[0].amount, 300)
        assert.equal(result.items[0].ledgerCategoryId, 11)
    })

    it("drops rows without a product name", () => {
        const result = normalizeAnalyzedReceipt({
            items: [{ rawName: "  ", amount: 100 }, { rawName: "牛乳", amount: 300 }],
        })
        assert.equal(result.items.length, 1)
        assert.equal(result.items[0].rawName, "牛乳")
    })

    it("turns a negative discount into a positive amount", () => {
        const result = normalizeAnalyzedReceipt({
            discountAmount: -50,
            items: [{ rawName: "牛乳", amount: 300, discount: -30 }],
        })
        assert.equal(result.discountAmount, 50)
        assert.equal(result.items[0].discount, 30)
    })

    it("rounds fractional yen and clamps confidence into 0..1", () => {
        const result = normalizeAnalyzedReceipt({
            totalAmount: 1000.4,
            confidence: 1.7,
            items: [{ rawName: "牛乳", amount: 299.6, confidence: -2 }],
        })
        assert.equal(result.totalAmount, 1000)
        assert.equal(result.confidence, 1)
        assert.equal(result.items[0].amount, 300)
        assert.equal(result.items[0].confidence, 0)
    })

    it("falls back to safe defaults when the model returns nothing usable", () => {
        const result = normalizeAnalyzedReceipt(null)
        assert.deepEqual(result, {
            storeName: null,
            purchasedAt: null,
            totalAmount: null,
            taxAmount: null,
            discountAmount: 0,
            taxIncludedInItems: true,
            confidence: 0,
            items: [],
        })
    })

    it("defaults quantity to 1 when it is missing or nonsensical", () => {
        const result = normalizeAnalyzedReceipt({
            items: [
                { rawName: "牛乳", amount: 300 },
                { rawName: "食パン", amount: 200, quantity: 0 },
            ],
        })
        assert.equal(result.items[0].quantity, 1)
        assert.equal(result.items[1].quantity, 1)
    })
})

describe("parseAnalysisResponse", () => {
    it("reads the JSON out of the text blocks", () => {
        const result = parseAnalysisResponse({
            content: [
                { type: "thinking", text: "ignored" },
                { type: "text", text: '{"storeName":"イオン","items":[]}' },
            ],
        })
        assert.equal(result.storeName, "イオン")
    })

    it("throws when the model refused", () => {
        assert.throws(
            () => parseAnalysisResponse({ stop_reason: "refusal", content: [] }),
            ReceiptAnalysisError
        )
    })

    it("throws when there is no text at all", () => {
        assert.throws(() => parseAnalysisResponse({ content: [] }), ReceiptAnalysisError)
    })

    it("throws when the text is not JSON", () => {
        assert.throws(
            () => parseAnalysisResponse({ content: [{ type: "text", text: "読み取れません" }] }),
            ReceiptAnalysisError
        )
    })
})

describe("analyzeReceiptImage", () => {
    const categories = [
        { ledgerCategoryId: 11, categoryName: "食費", genreName: "食料品" },
        { ledgerCategoryId: 12, categoryName: "食費", genreName: "カフェ" },
    ]

    // 使用量はDBへ書かず、ここへ集める（テストが開発DBを汚さないため）
    const recorded: AiUsageRecord[] = []

    async function withStubbedFetch(
        handler: (url: string, init: RequestInit) => Response,
        run: () => Promise<void>
    ) {
        const originalFetch = globalThis.fetch
        const originalKey = process.env.ANTHROPIC_API_KEY
        process.env.ANTHROPIC_API_KEY = "test-key"
        recorded.length = 0
        setAiUsageRecorder(async (record) => {
            recorded.push(record)
        })
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
            handler(String(input), init ?? {})) as typeof fetch
        try {
            await run()
        } finally {
            setAiUsageRecorder(null)
            globalThis.fetch = originalFetch
            if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
            else process.env.ANTHROPIC_API_KEY = originalKey
        }
    }

    it("records the usage of the call under the receipt-image feature", async () => {
        await withStubbedFetch(
            () =>
                new Response(
                    JSON.stringify({
                        model: "claude-opus-5-20260101",
                        content: [{ type: "text", text: '{"storeName":"イオン","items":[]}' }],
                        usage: {
                            input_tokens: 1200,
                            output_tokens: 340,
                            cache_read_input_tokens: 50,
                            cache_creation_input_tokens: 7,
                        },
                    }),
                    { status: 200 }
                ),
            async () => {
                await analyzeReceiptImage({ imageBase64: "AAAA", mimeType: "image/jpeg", categories })
            }
        )

        assert.deepEqual(recorded, [
            {
                feature: "receipt-image",
                model: "claude-opus-5-20260101",
                inputTokens: 1200,
                outputTokens: 340,
                cacheReadTokens: 50,
                cacheWriteTokens: 7,
            },
        ])
    })

    it("sends the image, the auth headers and a schema limited to the given categories", async () => {
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
                        content: [{ type: "text", text: '{"storeName":"イオン","items":[]}' }],
                    }),
                    { status: 200 }
                )
            },
            async () => {
                const result = await analyzeReceiptImage({
                    imageBase64: "AAAA",
                    mimeType: "image/jpeg",
                    categories,
                })
                assert.equal(result.storeName, "イオン")
            }
        )

        assert.equal(capturedUrl, ANTHROPIC_API_URL)
        assert.equal(headers["x-api-key"], "test-key")
        assert.equal(headers["anthropic-version"], ANTHROPIC_API_VERSION)
        assert.equal(body.model, DEFAULT_RECEIPT_MODEL)

        const messages = body.messages as Array<{ content: Array<Record<string, never>> }>
        const image = messages[0].content[0] as unknown as {
            type: string
            source: { media_type: string; data: string }
        }
        assert.equal(image.type, "image")
        assert.equal(image.source.media_type, "image/jpeg")
        assert.equal(image.source.data, "AAAA")

        // 実在しないカテゴリidを返させないよう、選択肢は家計簿のカテゴリから作った enum で縛る。
        const schema = (body.output_config as { format: { schema: Record<string, never> } }).format
            .schema as unknown as {
            properties: { items: { items: { required: string[]; properties: { ledgerCategoryId: { anyOf: { enum?: unknown[] }[] } } } } }
        }
        assert.deepEqual(schema.properties.items.items.properties.ledgerCategoryId.anyOf[0].enum, [11, 12])
        assert.ok(schema.properties.items.items.required.includes("ledgerCategoryId"))
        // プロンプトにも「id: 大分類 / 中分類」で選択肢を並べる
        const text = (messages[0].content[1] as unknown as { text: string }).text
        assert.match(text, /- 11: 食費 \/ 食料品/)
    })

    it("forces ledgerCategoryId to null when the user has no ledger categories yet", async () => {
        let body: Record<string, unknown> = {}
        await withStubbedFetch(
            (_url, init) => {
                body = JSON.parse(String(init.body))
                return new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }] }), {
                    status: 200,
                })
            },
            async () => {
                await analyzeReceiptImage({ imageBase64: "AAAA", mimeType: "image/png", categories: [] })
            }
        )

        const schema = (body.output_config as { format: { schema: Record<string, never> } }).format
            .schema as unknown as {
            properties: { items: { items: { properties: { ledgerCategoryId: { type: string } } } } }
        }
        assert.equal(schema.properties.items.items.properties.ledgerCategoryId.type, "null")
    })

    it("turns an auth failure and a rate limit into distinct messages", async () => {
        await withStubbedFetch(
            () => new Response("nope", { status: 401 }),
            async () => {
                await assert.rejects(
                    () => analyzeReceiptImage({ imageBase64: "A", mimeType: "image/png", categories }),
                    /認証に失敗/
                )
            }
        )
        await withStubbedFetch(
            () => new Response("slow down", { status: 429 }),
            async () => {
                await assert.rejects(
                    () => analyzeReceiptImage({ imageBase64: "A", mimeType: "image/png", categories }),
                    /利用制限/
                )
            }
        )
    })

    function textResponse(payload: unknown): Response {
        return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(payload) }] }), {
            status: 200,
        })
    }

    const greenTea = { rawName: "イトウエンクロマメチャ 650ml", quantity: 1, unitPrice: null, discount: 20, ledgerCategoryId: 11, confidence: 0.9 }

    it("adds an exclusive tax to the items without asking again (#1309)", async () => {
        let calls = 0
        await withStubbedFetch(
            () => {
                calls += 1
                return textResponse({
                    totalAmount: 149,
                    taxAmount: 11,
                    taxIncludedInItems: true,
                    items: [{ ...greenTea, amount: 138 }],
                })
            },
            async () => {
                const result = await analyzeReceiptImage({ imageBase64: "A", mimeType: "image/png", categories })
                assert.equal(result.items[0].amount, 149)
                assert.equal(result.taxIncludedInItems, true)
            }
        )
        assert.equal(calls, 1)
    })

    it("re-reads once with attention to the tax lines when the items do not add up (#1309)", async () => {
        const prompts: string[] = []
        await withStubbedFetch(
            (_url, init) => {
                const body = JSON.parse(String(init.body)) as { messages: Array<{ content: Array<{ text?: string }> }> }
                prompts.push(body.messages[0].content[1].text ?? "")
                // 1回目は消費税を読み落とし、2回目で外税の消費税を読めた
                return prompts.length === 1
                    ? textResponse({ totalAmount: 149, taxAmount: null, taxIncludedInItems: true, items: [{ ...greenTea, amount: 138 }] })
                    : textResponse({ totalAmount: 149, taxAmount: 11, taxIncludedInItems: false, items: [{ ...greenTea, amount: 138 }] })
            },
            async () => {
                const result = await analyzeReceiptImage({ imageBase64: "A", mimeType: "image/png", categories })
                assert.equal(result.items[0].amount, 149)
                assert.equal(result.taxAmount, 11)
            }
        )
        assert.equal(prompts.length, 2)
        assert.doesNotMatch(prompts[0], /消費税の行を特に注意/)
        assert.match(prompts[1], /消費税の行を特に注意/)
        assert.match(prompts[1], /ずれ 11 円/)
        // 読み直しも使用量へ記録する
        assert.equal(recorded.length, 2)
    })

    it("keeps the first reading when the second one is no closer to the total", async () => {
        let calls = 0
        await withStubbedFetch(
            () => {
                calls += 1
                return calls === 1
                    ? textResponse({ totalAmount: 149, items: [{ ...greenTea, amount: 138 }] })
                    : textResponse({ totalAmount: 149, items: [{ ...greenTea, amount: 100 }] })
            },
            async () => {
                const result = await analyzeReceiptImage({ imageBase64: "A", mimeType: "image/png", categories })
                assert.equal(result.items[0].amount, 138)
            }
        )
        assert.equal(calls, 2)
    })

    it("keeps the first reading when the second request fails", async () => {
        let calls = 0
        await withStubbedFetch(
            () => {
                calls += 1
                return calls === 1
                    ? textResponse({ totalAmount: 149, items: [{ ...greenTea, amount: 138 }] })
                    : new Response("boom", { status: 500 })
            },
            async () => {
                const result = await analyzeReceiptImage({ imageBase64: "A", mimeType: "image/png", categories })
                assert.equal(result.items[0].amount, 138)
            }
        )
    })

    it("fails clearly when the API key is missing", async () => {
        const originalKey = process.env.ANTHROPIC_API_KEY
        delete process.env.ANTHROPIC_API_KEY
        try {
            await assert.rejects(
                () => analyzeReceiptImage({ imageBase64: "A", mimeType: "image/png", categories }),
                /ANTHROPIC_API_KEY/
            )
        } finally {
            if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey
        }
    })
})

describe("normalizeAiClassifiedItems", () => {
    it("returns one row per input item, in input order", () => {
        const result = normalizeAiClassifiedItems(
            {
                items: [
                    { index: 1, ledgerCategoryId: 12, confidence: 0.8 },
                    { index: 0, ledgerCategoryId: 11, confidence: 0.95 },
                ],
            },
            2
        )
        assert.deepEqual(result, [
            { index: 0, ledgerCategoryId: 11, confidence: 0.95 },
            { index: 1, ledgerCategoryId: 12, confidence: 0.8 },
        ])
    })

    it("treats items the model skipped as unclassified", () => {
        const result = normalizeAiClassifiedItems({ items: [] }, 2)
        assert.deepEqual(result, [
            { index: 0, ledgerCategoryId: null, confidence: 0 },
            { index: 1, ledgerCategoryId: null, confidence: 0 },
        ])
    })

    it("drops rows pointing outside the input and clamps the confidence", () => {
        const result = normalizeAiClassifiedItems(
            {
                items: [
                    { index: 5, ledgerCategoryId: 12, confidence: 1 },
                    { index: 0, ledgerCategoryId: 12, confidence: 4 },
                ],
            },
            1
        )
        assert.deepEqual(result, [{ index: 0, ledgerCategoryId: 12, confidence: 1 }])
    })

    it("survives a malformed payload", () => {
        assert.deepEqual(normalizeAiClassifiedItems(null, 1), [
            { index: 0, ledgerCategoryId: null, confidence: 0 },
        ])
    })
})

describe("parseClassificationResponse", () => {
    it("reads the JSON out of the text block", () => {
        const result = parseClassificationResponse(
            {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            items: [{ index: 0, ledgerCategoryId: 13, confidence: 0.7 }],
                        }),
                    },
                ],
            },
            1
        )
        assert.deepEqual(result, [{ index: 0, ledgerCategoryId: 13, confidence: 0.7 }])
    })

    it("fails clearly when the model refuses or returns nothing", () => {
        assert.throws(
            () => parseClassificationResponse({ stop_reason: "refusal" }, 1),
            ReceiptAnalysisError
        )
        assert.throws(() => parseClassificationResponse({ content: [] }, 1), ReceiptAnalysisError)
    })
})

describe("normalizeCategoryCandidates", () => {
    it("存在しないカテゴリ・重複を落とし、3件で切る", () => {
        const result = normalizeCategoryCandidates(
            {
                candidates: [
                    { ledgerCategoryId: 1, reason: "a" },
                    { ledgerCategoryId: 99, reason: "存在しない" },
                    { ledgerCategoryId: 1, reason: "重複" },
                    { ledgerCategoryId: 2, reason: "b" },
                    { ledgerCategoryId: 3, reason: "c" },
                    { ledgerCategoryId: 4, reason: "d" },
                ],
            },
            [1, 2, 3, 4]
        )
        assert.deepEqual(result.map((c) => c.ledgerCategoryId), [1, 2, 3])
    })

    it("形が崩れていても空配列を返す", () => {
        assert.deepEqual(normalizeCategoryCandidates(null, [1]), [])
        assert.deepEqual(normalizeCategoryCandidates({ candidates: "x" }, [1]), [])
    })
})

describe("buildCategoryIdProperty / buildCategoryGuide", () => {
    const categories = [
        { ledgerCategoryId: 11, categoryName: "食費", genreName: "食料品" },
        { ledgerCategoryId: 20, categoryName: "交際費", genreName: null },
    ]

    it("選べるカテゴリのidと null だけを許す（型の配列と enum を併せない。#1041）", () => {
        assert.deepEqual(buildCategoryIdProperty(categories), {
            anyOf: [{ type: "integer", enum: [11, 20] }, { type: "null" }],
            description: "この商品に最も近い家計簿のカテゴリのid。判断できない場合は null。",
        })
    })

    it("カテゴリが無ければ null しか返させない", () => {
        assert.equal(buildCategoryIdProperty([]).type, "null")
        assert.match(buildCategoryGuide([]), /すべて null/)
    })

    it("「id: 大分類 / 中分類」で並べ、中分類の無い大分類は大分類名だけにする", () => {
        const guide = buildCategoryGuide(categories)
        assert.match(guide, /^- 11: 食費 \/ 食料品$/m)
        assert.match(guide, /^- 20: 交際費$/m)
    })
})
