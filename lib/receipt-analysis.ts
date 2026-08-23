/**
 * レシート画像のAI解析（Issue #153 Phase 1）。
 *
 * Claude の Messages API を `fetch` で直接呼ぶ。SDK（`@anthropic-ai/sdk`）を入れないのは、
 * 呼ぶのがこの1エンドポイントだけで、依存を増やす価値が無いため。
 * 出力のゆらぎで落ちないよう、`output_config.format` の JSON Schema で構造化出力を強制する。
 */

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
export const ANTHROPIC_API_VERSION = "2023-06-01"
export const DEFAULT_RECEIPT_MODEL = "claude-opus-5"

/** 解析に許容する画像サイズ。Claude API 側の上限より手前で弾く。 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export const SUPPORTED_IMAGE_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
] as const

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number]

export function isSupportedImageMimeType(value: string): value is SupportedImageMimeType {
    return (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(value)
}

export class ReceiptAnalysisError extends Error {
    constructor(
        message: string,
        readonly cause?: unknown
    ) {
        super(message)
        this.name = "ReceiptAnalysisError"
    }
}

/** AIに選ばせる内訳の候補。Zaimのマスタから作る。 */
export interface ReceiptGenreOption {
    zaimGenreId: number
    zaimCategoryId: number
    genreName: string
    categoryName: string
}

export interface AnalyzedReceiptItem {
    rawName: string
    quantity: number
    unitPrice: number | null
    amount: number
    discount: number
    zaimGenreId: number | null
    confidence: number
}

export interface AnalyzedReceipt {
    storeName: string | null
    /** `YYYY-MM-DDTHH:mm`（JST）。時刻が読めない場合は日付だけ。 */
    purchasedAt: string | null
    totalAmount: number | null
    taxAmount: number | null
    discountAmount: number | null
    /** 商品の金額が税込か。外税表示のレシートは false。 */
    taxIncludedInItems: boolean
    confidence: number
    items: AnalyzedReceiptItem[]
}

const SYSTEM_PROMPT = [
    "あなたは日本のレシート画像を読み取って構造化するアシスタントです。",
    "印字されている内容だけを使い、読み取れない項目は推測せず null にしてください。",
    "金額はすべて円単位の整数で返します（小数・カンマ・通貨記号を含めない）。",
    "商品の amount は、その行の値引きを適用したあとの支払額です。値引き行が独立して印字されている場合は、",
    "対応する商品の discount へ正の数として計上し、値引き行そのものを商品として返さないでください。",
    "confidence は 0.0〜1.0 で、印字がかすれている・複数の解釈がありうる場合ほど低くします。",
    "自信がある項目まで低く申告すると人手の確認が増えるだけなので、はっきり読めた項目は高くしてください。",
].join("\n")

function buildResponseSchema(genres: ReceiptGenreOption[]): Record<string, unknown> {
    const genreProperty: Record<string, unknown> =
        genres.length > 0
            ? {
                  type: ["integer", "null"],
                  // 実在する内訳しか選べないようにする。存在しないidを返されると保存時に落ちる。
                  enum: [...genres.map((genre) => genre.zaimGenreId), null],
                  description: "この商品に最も近い内訳のid。判断できない場合は null。",
              }
            : {
                  type: "null",
                  description: "Zaimの内訳マスタが未取得のため、必ず null を返す。",
              }

    return {
        type: "object",
        additionalProperties: false,
        required: [
            "storeName",
            "purchasedAt",
            "totalAmount",
            "taxAmount",
            "discountAmount",
            "taxIncludedInItems",
            "confidence",
            "items",
        ],
        properties: {
            storeName: {
                type: ["string", "null"],
                description: "店舗名。支店名まで印字されていれば含める。",
            },
            purchasedAt: {
                type: ["string", "null"],
                description:
                    "購入日時。日本時間で YYYY-MM-DDTHH:mm 形式。時刻が印字されていない場合は YYYY-MM-DD。",
            },
            totalAmount: {
                type: ["integer", "null"],
                description: "レシートに印字された支払総額（円）。",
            },
            taxAmount: {
                type: ["integer", "null"],
                description: "消費税の合計額（円）。印字が無ければ null。",
            },
            discountAmount: {
                type: ["integer", "null"],
                description: "レシート全体にかかる値引きの合計（円・正の数）。無ければ 0。",
            },
            taxIncludedInItems: {
                type: "boolean",
                description: "各商品の amount が税込価格なら true、外税（本体価格）なら false。",
            },
            confidence: {
                type: "number",
                description: "レシート全体の読み取り信頼度（0.0〜1.0）。",
            },
            items: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                        "rawName",
                        "quantity",
                        "unitPrice",
                        "amount",
                        "discount",
                        "zaimGenreId",
                        "confidence",
                    ],
                    properties: {
                        rawName: {
                            type: "string",
                            description: "レシートに印字されている商品名をそのまま。",
                        },
                        quantity: { type: "number", description: "数量。印字が無ければ 1。" },
                        unitPrice: {
                            type: ["integer", "null"],
                            description: "単価（円）。印字が無ければ null。",
                        },
                        amount: {
                            type: "integer",
                            description: "値引き適用後の支払額（円）。",
                        },
                        discount: {
                            type: "integer",
                            description: "この商品にかかった値引き額（円・正の数）。無ければ 0。",
                        },
                        zaimGenreId: genreProperty,
                        confidence: {
                            type: "number",
                            description: "この行の読み取り信頼度（0.0〜1.0）。",
                        },
                    },
                },
            },
        },
    }
}

function buildGenreGuide(genres: ReceiptGenreOption[]): string {
    if (genres.length === 0) {
        return "Zaimの内訳マスタが未取得のため、zaimGenreId はすべて null にしてください。"
    }
    const lines = genres.map(
        (genre) => `- ${genre.zaimGenreId}: ${genre.categoryName} / ${genre.genreName}`
    )
    return ["選べる内訳は次のとおりです。", ...lines].join("\n")
}

export interface AnalyzeReceiptInput {
    imageBase64: string
    mimeType: SupportedImageMimeType
    genres: ReceiptGenreOption[]
    /** 過去に確定したレシートの店舗名。表記を揃えるためのヒント。 */
    knownStoreNames?: string[]
}

interface AnthropicTextBlock {
    type: string
    text?: string
}

interface AnthropicMessageResponse {
    content?: AnthropicTextBlock[]
    stop_reason?: string
}

/** 未設定なら null。呼び出し側は「AI解析を使えない」として扱う。 */
export function getAnthropicApiKey(): string | null {
    return process.env.ANTHROPIC_API_KEY || null
}

export function getReceiptModel(): string {
    return process.env.ANTHROPIC_RECEIPT_MODEL || DEFAULT_RECEIPT_MODEL
}

/**
 * 応答から構造化結果を取り出す。
 * 構造化出力でもテキストブロックとして返るため、JSONの取り出しはこちらで行う。
 */
export function parseAnalysisResponse(response: AnthropicMessageResponse): AnalyzedReceipt {
    if (response.stop_reason === "refusal") {
        throw new ReceiptAnalysisError("AIが解析を拒否しました。別の画像で試してください。")
    }

    const text = (response.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("")

    if (!text.trim()) {
        throw new ReceiptAnalysisError("AIから解析結果が返りませんでした")
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch (error) {
        throw new ReceiptAnalysisError("AIの解析結果を解釈できませんでした", error)
    }

    return normalizeAnalyzedReceipt(parsed)
}

function toNullableInteger(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null
    return Math.round(value)
}

function toConfidence(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0
    return Math.min(1, Math.max(0, value))
}

/**
 * 構造化出力でも型がずれることはあるため、保存前にここで正規化する。
 * 数値でないもの・負の金額などは落とし、確認画面で人が直せる形にする。
 */
export function normalizeAnalyzedReceipt(parsed: unknown): AnalyzedReceipt {
    const raw = (parsed ?? {}) as Record<string, unknown>
    const rawItems = Array.isArray(raw.items) ? raw.items : []

    const items: AnalyzedReceiptItem[] = rawItems
        .map((entry) => {
            const item = (entry ?? {}) as Record<string, unknown>
            const rawName = typeof item.rawName === "string" ? item.rawName.trim() : ""
            if (!rawName) return null

            const quantity =
                typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0
                    ? item.quantity
                    : 1

            return {
                rawName,
                quantity,
                unitPrice: toNullableInteger(item.unitPrice),
                amount: toNullableInteger(item.amount) ?? 0,
                discount: Math.abs(toNullableInteger(item.discount) ?? 0),
                zaimGenreId: toNullableInteger(item.zaimGenreId),
                confidence: toConfidence(item.confidence),
            }
        })
        .filter((item): item is AnalyzedReceiptItem => item !== null)

    return {
        storeName: typeof raw.storeName === "string" && raw.storeName.trim() ? raw.storeName.trim() : null,
        purchasedAt:
            typeof raw.purchasedAt === "string" && raw.purchasedAt.trim()
                ? raw.purchasedAt.trim()
                : null,
        totalAmount: toNullableInteger(raw.totalAmount),
        taxAmount: toNullableInteger(raw.taxAmount),
        discountAmount: Math.abs(toNullableInteger(raw.discountAmount) ?? 0),
        taxIncludedInItems: raw.taxIncludedInItems !== false,
        confidence: toConfidence(raw.confidence),
        items,
    }
}

export async function analyzeReceiptImage(input: AnalyzeReceiptInput): Promise<AnalyzedReceipt> {
    const apiKey = getAnthropicApiKey()
    if (!apiKey) {
        throw new ReceiptAnalysisError(
            "ANTHROPIC_API_KEY が設定されていないため、レシートを解析できません"
        )
    }

    const storeHint =
        input.knownStoreNames && input.knownStoreNames.length > 0
            ? "過去に取り込んだ店舗名: " +
              input.knownStoreNames.slice(0, 30).join(" / ") +
              "\n同じ店舗であれば、この表記に合わせてください。"
            : ""

    const prompt = [
        "このレシート画像を読み取り、指定されたJSON形式で返してください。",
        buildGenreGuide(input.genres),
        storeHint,
    ]
        .filter(Boolean)
        .join("\n\n")

    let response: Response
    try {
        response = await fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": ANTHROPIC_API_VERSION,
            },
            body: JSON.stringify({
                model: getReceiptModel(),
                max_tokens: 16000,
                system: SYSTEM_PROMPT,
                output_config: {
                    format: {
                        type: "json_schema",
                        schema: buildResponseSchema(input.genres),
                    },
                },
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "image",
                                source: {
                                    type: "base64",
                                    media_type: input.mimeType,
                                    data: input.imageBase64,
                                },
                            },
                            { type: "text", text: prompt },
                        ],
                    },
                ],
            }),
            // 画像1枚の解析。ネットワークが詰まったまま待ち続けないよう上限を置く。
            signal: AbortSignal.timeout(180_000),
        })
    } catch (error) {
        throw new ReceiptAnalysisError("AIへの接続に失敗しました", error)
    }

    if (!response.ok) {
        const body = await response.text().catch(() => "")
        console.error("Receipt analysis failed:", response.status, body.slice(0, 500))
        if (response.status === 401 || response.status === 403) {
            throw new ReceiptAnalysisError("AIの認証に失敗しました。APIキーを確認してください。")
        }
        if (response.status === 429) {
            throw new ReceiptAnalysisError("AIの利用制限に達しました。時間をおいて再実行してください。")
        }
        throw new ReceiptAnalysisError("AIの解析に失敗しました (HTTP " + response.status + ")")
    }

    const json = (await response.json()) as AnthropicMessageResponse
    return parseAnalysisResponse(json)
}
