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

/**
 * 実在する内訳しか選べないようにするスキーマ片。存在しないidを返されると保存時に落ちるため、
 * 画像解析と商品名分類の両方でこれを使う。
 */
function buildGenreIdProperty(genres: ReceiptGenreOption[]): Record<string, unknown> {
    if (genres.length === 0) {
        return {
            type: "null",
            description: "Zaimの内訳マスタが未取得のため、必ず null を返す。",
        }
    }
    return {
        type: ["integer", "null"],
        enum: [...genres.map((genre) => genre.zaimGenreId), null],
        description: "この商品に最も近い内訳のid。判断できない場合は null。",
    }
}

function buildResponseSchema(genres: ReceiptGenreOption[]): Record<string, unknown> {
    const genreProperty = buildGenreIdProperty(genres)

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

    const json = await requestAnthropicMessage(apiKey, {
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
    })
    return parseAnalysisResponse(json)
}

/**
 * Anthropic APIを1回呼ぶ。画像解析（`analyzeReceiptImage`）と
 * 商品名の分類（`classifyItemsWithAi`）で失敗時の扱いを揃えるため、通信はここへ寄せる。
 */
async function requestAnthropicMessage(
    apiKey: string,
    body: Record<string, unknown>
): Promise<AnthropicMessageResponse> {
    let response: Response
    try {
        response = await fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": ANTHROPIC_API_VERSION,
            },
            body: JSON.stringify(body),
            // ネットワークが詰まったまま待ち続けないよう上限を置く。
            signal: AbortSignal.timeout(180_000),
        })
    } catch (error) {
        throw new ReceiptAnalysisError("AIへの接続に失敗しました", error)
    }

    if (!response.ok) {
        const text = await response.text().catch(() => "")
        console.error("Receipt analysis failed:", response.status, text.slice(0, 500))
        if (response.status === 401 || response.status === 403) {
            throw new ReceiptAnalysisError("AIの認証に失敗しました。APIキーを確認してください。")
        }
        if (response.status === 429) {
            throw new ReceiptAnalysisError("AIの利用制限に達しました。時間をおいて再実行してください。")
        }
        throw new ReceiptAnalysisError("AIの解析に失敗しました (HTTP " + response.status + ")")
    }

    return (await response.json()) as AnthropicMessageResponse
}

const MAIL_SYSTEM_PROMPT = [
    "あなたは購入・決済に関する日本語のメール本文を読み取って、家計簿の明細へ構造化するアシスタントです。",
    "本文に書かれている内容だけを使い、読み取れない項目は推測せず null にしてください。",
    "金額はすべて円単位の整数で返します（小数・カンマ・通貨記号を含めない）。",
    "storeName は購入先（店舗・サービス）の名前です。差出人の会社名しか分からない場合はそれを使ってください。",
    "totalAmount は請求・決済の総額です。ポイント利用・値引き後の実際の支払額を優先します。",
    "商品の明細が並んでいる場合は items に1行ずつ入れ、送料・手数料も1行として扱ってください。",
    "明細が書かれておらず総額だけのメールでは、items に総額の1行だけを入れます。",
    "**購入・決済のメールでない場合（広告・お知らせ・発送通知だけ など）は totalAmount を null にし、items を空にしてください。**",
    "confidence は 0.0〜1.0 で、本文から金額や品目を一意に読み取れないほど低くします。",
].join("\n")

export interface AnalyzeReceiptMailInput {
    subject: string
    from: string
    /** 受信日時。`YYYY-MM-DDTHH:mm`（JST）。 */
    receivedAt: string | null
    /** 本文のテキスト。HTMLしか無いメールは `htmlToText` で落としてから渡す。 */
    body: string
    genres: ReceiptGenreOption[]
}

/**
 * メール本文から明細を組み立てる（Issue #271）。
 *
 * 画像解析（`analyzeReceiptImage`）と同じスキーマ・同じ正規化を通すのは、
 * このあとの検算（`lib/receipt-verify.ts`）と確認画面を1本で扱えるようにするため。
 * **購入のメールでなければ `totalAmount` が null で返る**ので、呼び出し側はそれを見て取り込みを見送る。
 */
export async function analyzeReceiptMail(input: AnalyzeReceiptMailInput): Promise<AnalyzedReceipt> {
    const apiKey = getAnthropicApiKey()
    if (!apiKey) {
        throw new ReceiptAnalysisError(
            "ANTHROPIC_API_KEY が設定されていないため、メールを解析できません"
        )
    }

    const header = [
        "差出人: " + input.from,
        "件名: " + input.subject,
        input.receivedAt ? "受信日時: " + input.receivedAt + "（日本時間）" : "",
    ]
        .filter(Boolean)
        .join("\n")

    const prompt = [
        "次のメールを読み取り、指定されたJSON形式で返してください。",
        header,
        buildGenreGuide(input.genres),
        "本文:\n" + input.body,
    ]
        .filter(Boolean)
        .join("\n\n")

    const json = await requestAnthropicMessage(apiKey, {
        model: getReceiptModel(),
        max_tokens: 16000,
        system: MAIL_SYSTEM_PROMPT,
        output_config: {
            format: {
                type: "json_schema",
                schema: buildResponseSchema(input.genres),
            },
        },
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    })

    return parseAnalysisResponse(json)
}

const CLASSIFY_SYSTEM_PROMPT = [
    "あなたは家計簿の商品名を、指定された内訳（ジャンル）へ分類するアシスタントです。",
    "商品名から判断できる範囲で分類し、判断できない場合は zaimGenreId を null にしてください。",
    "confidence は 0.0〜1.0 で、商品名だけでは内訳を1つに絞れない場合ほど低くします。",
    "略語・型番だけの商品名や、複数の内訳にまたがりうる商品名は、無理に分類せず低い confidence を返してください。",
    "商品名のあとに ［店舗名］ が付いている行は、その店舗での購入として分類してください。",
].join("\n")

export interface ClassifiableSourceItem {
    rawName: string
    amount: number
    /**
     * その行だけの店舗名。1回の呼び出しに複数の店舗が混ざる場合に使う（Issue #271）。
     * レシート1枚を分類するときは店舗が1つなので `ClassifyItemsInput.storeName` を使う。
     */
    storeName?: string | null
}

export interface AiClassifiedItem {
    /** 入力した商品リストの番号（0始まり）。 */
    index: number
    zaimGenreId: number | null
    confidence: number
}

export interface ClassifyItemsInput {
    items: ClassifiableSourceItem[]
    storeName: string | null
    genres: ReceiptGenreOption[]
    /** 「スマートレシート」「Amazon」など、明細の出どころ。分類のヒントになる。 */
    sourceLabel?: string
}

function buildClassificationSchema(genres: ReceiptGenreOption[]): Record<string, unknown> {
    const genreProperty = buildGenreIdProperty(genres)

    return {
        type: "object",
        additionalProperties: false,
        required: ["items"],
        properties: {
            items: {
                type: "array",
                description: "入力した商品と同じ件数・同じ順序で返す。",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["index", "zaimGenreId", "confidence"],
                    properties: {
                        index: {
                            type: "integer",
                            description: "入力した商品リストの番号（0始まり）。",
                        },
                        zaimGenreId: genreProperty,
                        confidence: {
                            type: "number",
                            description: "0.0〜1.0。分類の確からしさ。",
                        },
                    },
                },
            },
        },
    }
}

/** 件数・順序・値のずれをここで吸収する。入力した商品の数だけ必ず返す。 */
export function normalizeAiClassifiedItems(parsed: unknown, itemCount: number): AiClassifiedItem[] {
    const raw = (parsed ?? {}) as { items?: unknown }
    const rows = Array.isArray(raw.items) ? raw.items : []

    const byIndex = new Map<number, AiClassifiedItem>()
    for (const row of rows) {
        const entry = (row ?? {}) as Record<string, unknown>
        const index = toNullableInteger(entry.index)
        if (index === null || index < 0 || index >= itemCount) continue
        byIndex.set(index, {
            index,
            zaimGenreId: toNullableInteger(entry.zaimGenreId),
            confidence: toConfidence(entry.confidence),
        })
    }

    return Array.from({ length: itemCount }, (_, index) => {
        // 返ってこなかった商品は「分類できなかった」として扱う。確認待ちに落ちる。
        return byIndex.get(index) ?? { index, zaimGenreId: null, confidence: 0 }
    })
}

export function parseClassificationResponse(
    response: AnthropicMessageResponse,
    itemCount: number
): AiClassifiedItem[] {
    if (response.stop_reason === "refusal") {
        throw new ReceiptAnalysisError("AIが分類を拒否しました")
    }

    const text = (response.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("")

    if (!text.trim()) {
        throw new ReceiptAnalysisError("AIから分類結果が返りませんでした")
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch (error) {
        throw new ReceiptAnalysisError("AIの分類結果を解釈できませんでした", error)
    }

    return normalizeAiClassifiedItems(parsed, itemCount)
}

/**
 * 商品名だけを手がかりに内訳を分類する（Issue #222）。
 *
 * スマートレシート・Amazon由来の明細には画像が無いため、画像解析（`analyzeReceiptImage`）は使えない。
 * 分類履歴で決まらなかった商品だけをここへ渡す前提で、呼び出し回数を抑えている。
 */
export async function classifyItemsWithAi(input: ClassifyItemsInput): Promise<AiClassifiedItem[]> {
    if (input.items.length === 0) return []

    const apiKey = getAnthropicApiKey()
    if (!apiKey) {
        throw new ReceiptAnalysisError(
            "ANTHROPIC_API_KEY が設定されていないため、内訳を分類できません"
        )
    }

    const context = [
        input.sourceLabel ? "明細の出どころ: " + input.sourceLabel : "",
        input.storeName ? "店舗名: " + input.storeName : "",
    ]
        .filter(Boolean)
        .join("\n")

    const itemLines = input.items
        .map((item, index) => {
            const store = item.storeName?.trim()
            return `${index}: ${item.rawName}（${item.amount}円）` + (store ? `［${store}］` : "")
        })
        .join("\n")

    const prompt = [
        "次の商品をそれぞれ内訳へ分類し、指定されたJSON形式で返してください。",
        context,
        buildGenreGuide(input.genres),
        "商品:\n" + itemLines,
    ]
        .filter(Boolean)
        .join("\n\n")

    const json = await requestAnthropicMessage(apiKey, {
        model: getReceiptModel(),
        max_tokens: 8000,
        system: CLASSIFY_SYSTEM_PROMPT,
        output_config: {
            format: {
                type: "json_schema",
                schema: buildClassificationSchema(input.genres),
            },
        },
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    })

    return parseClassificationResponse(json, input.items.length)
}
