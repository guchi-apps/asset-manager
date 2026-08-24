import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    ANTHROPIC_API_URL,
    ANTHROPIC_API_VERSION,
    DEFAULT_RECEIPT_MODEL,
    ReceiptAnalysisError,
    analyzeReceiptImage,
    isSupportedImageMimeType,
    normalizeAiClassifiedItems,
    normalizeAnalyzedReceipt,
    parseAnalysisResponse,
    parseClassificationResponse,
} from "./receipt-analysis"

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
                    zaimGenreId: 10101,
                    confidence: 0.9,
                },
            ],
        })

        assert.equal(result.storeName, "イオン 西新井店")
        assert.equal(result.totalAmount, 1000)
        assert.equal(result.items.length, 1)
        assert.equal(result.items[0].amount, 300)
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
    const genres = [
        { zaimGenreId: 10101, zaimCategoryId: 101, genreName: "食料品", categoryName: "食費" },
        { zaimGenreId: 10102, zaimCategoryId: 101, genreName: "カフェ", categoryName: "食費" },
    ]

    async function withStubbedFetch(
        handler: (url: string, init: RequestInit) => Response,
        run: () => Promise<void>
    ) {
        const originalFetch = globalThis.fetch
        const originalKey = process.env.ANTHROPIC_API_KEY
        process.env.ANTHROPIC_API_KEY = "test-key"
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
            handler(String(input), init ?? {})) as typeof fetch
        try {
            await run()
        } finally {
            globalThis.fetch = originalFetch
            if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
            else process.env.ANTHROPIC_API_KEY = originalKey
        }
    }

    it("sends the image, the auth headers and a schema limited to the given genres", async () => {
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
                    genres,
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

        // 実在しない内訳idを返させないよう、選択肢はマスタから作った enum で縛る。
        const schema = (body.output_config as { format: { schema: Record<string, never> } }).format
            .schema as unknown as {
            properties: { items: { items: { properties: { zaimGenreId: { enum: unknown[] } } } } }
        }
        assert.deepEqual(schema.properties.items.items.properties.zaimGenreId.enum, [
            10101, 10102, null,
        ])
    })

    it("forces zaimGenreId to null when no genre master has been imported", async () => {
        let body: Record<string, unknown> = {}
        await withStubbedFetch(
            (_url, init) => {
                body = JSON.parse(String(init.body))
                return new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }] }), {
                    status: 200,
                })
            },
            async () => {
                await analyzeReceiptImage({ imageBase64: "AAAA", mimeType: "image/png", genres: [] })
            }
        )

        const schema = (body.output_config as { format: { schema: Record<string, never> } }).format
            .schema as unknown as {
            properties: { items: { items: { properties: { zaimGenreId: { type: string } } } } }
        }
        assert.equal(schema.properties.items.items.properties.zaimGenreId.type, "null")
    })

    it("turns an auth failure and a rate limit into distinct messages", async () => {
        await withStubbedFetch(
            () => new Response("nope", { status: 401 }),
            async () => {
                await assert.rejects(
                    () => analyzeReceiptImage({ imageBase64: "A", mimeType: "image/png", genres }),
                    /認証に失敗/
                )
            }
        )
        await withStubbedFetch(
            () => new Response("slow down", { status: 429 }),
            async () => {
                await assert.rejects(
                    () => analyzeReceiptImage({ imageBase64: "A", mimeType: "image/png", genres }),
                    /利用制限/
                )
            }
        )
    })

    it("fails clearly when the API key is missing", async () => {
        const originalKey = process.env.ANTHROPIC_API_KEY
        delete process.env.ANTHROPIC_API_KEY
        try {
            await assert.rejects(
                () => analyzeReceiptImage({ imageBase64: "A", mimeType: "image/png", genres }),
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
                    { index: 1, zaimGenreId: 10102, confidence: 0.8 },
                    { index: 0, zaimGenreId: 29784033, confidence: 0.95 },
                ],
            },
            2
        )
        assert.deepEqual(result, [
            { index: 0, zaimGenreId: 29784033, confidence: 0.95 },
            { index: 1, zaimGenreId: 10102, confidence: 0.8 },
        ])
    })

    it("treats items the model skipped as unclassified", () => {
        const result = normalizeAiClassifiedItems({ items: [] }, 2)
        assert.deepEqual(result, [
            { index: 0, zaimGenreId: null, confidence: 0 },
            { index: 1, zaimGenreId: null, confidence: 0 },
        ])
    })

    it("drops rows pointing outside the input and clamps the confidence", () => {
        const result = normalizeAiClassifiedItems(
            {
                items: [
                    { index: 5, zaimGenreId: 10102, confidence: 1 },
                    { index: 0, zaimGenreId: 10102, confidence: 4 },
                ],
            },
            1
        )
        assert.deepEqual(result, [{ index: 0, zaimGenreId: 10102, confidence: 1 }])
    })

    it("survives a malformed payload", () => {
        assert.deepEqual(normalizeAiClassifiedItems(null, 1), [
            { index: 0, zaimGenreId: null, confidence: 0 },
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
                            items: [{ index: 0, zaimGenreId: 10103, confidence: 0.7 }],
                        }),
                    },
                ],
            },
            1
        )
        assert.deepEqual(result, [{ index: 0, zaimGenreId: 10103, confidence: 0.7 }])
    })

    it("fails clearly when the model refuses or returns nothing", () => {
        assert.throws(
            () => parseClassificationResponse({ stop_reason: "refusal" }, 1),
            ReceiptAnalysisError
        )
        assert.throws(() => parseClassificationResponse({ content: [] }, 1), ReceiptAnalysisError)
    })
})
