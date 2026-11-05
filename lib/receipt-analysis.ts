/**
 * レシート画像のAI解析（Issue #153 Phase 1）。
 *
 * Claude の Messages API の呼び出しは `lib/anthropic-messages.ts`（`fetch` 直叩き・SDK無し）に
 * 寄せてあり、ここでは失敗を `ReceiptAnalysisError` へ変換する。
 * 出力のゆらぎで落ちないよう、`output_config.format` の JSON Schema で構造化出力を強制する。
 */

import type { AiFeature } from "@/lib/ai-usage"
import {
    AnthropicRequestError,
    describeAnthropicFailure,
    extractTextContent,
    getAnthropicApiKey,
    requestAnthropicMessage,
    type AnthropicMessageResponse,
} from "@/lib/anthropic-messages"

import { choiceLabel, type ReceiptCategoryChoice } from "@/lib/receipt-category-choices"

// 以前はこのファイルが持っていた。import 元を変えずに済むよう再公開する。
export { ANTHROPIC_API_URL, ANTHROPIC_API_VERSION, getAnthropicApiKey } from "@/lib/anthropic-messages"

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

/**
 * AIに選ばせる分類の候補。家計簿の支出のカテゴリ（中分類と、中分類を持たない大分類）から作る（Issue #843。
 * 以前はZaimの内訳マスタだった）。作り方は `lib/receipt-category-choices.ts` の `buildReceiptCategoryChoices`。
 */
export type ReceiptCategoryOption = Pick<ReceiptCategoryChoice, "ledgerCategoryId" | "categoryName" | "genreName">

export interface AnalyzedReceiptItem {
    rawName: string
    quantity: number
    unitPrice: number | null
    amount: number
    discount: number
    ledgerCategoryId: number | null
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
 * 実在するカテゴリしか選べないようにするスキーマ片。存在しないidを返されると保存時に落ちるため、
 * 画像解析と商品名分類の両方でこれを使う。
 */
export function buildCategoryIdProperty(categories: ReceiptCategoryOption[]): Record<string, unknown> {
    if (categories.length === 0) {
        return {
            type: "null",
            description: "家計簿のカテゴリがまだ無いため、必ず null を返す。",
        }
    }
    return {
        type: ["integer", "null"],
        enum: [...categories.map((category) => category.ledgerCategoryId), null],
        description: "この商品に最も近い家計簿のカテゴリのid。判断できない場合は null。",
    }
}

function buildResponseSchema(categories: ReceiptCategoryOption[]): Record<string, unknown> {
    const categoryProperty = buildCategoryIdProperty(categories)

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
                        "ledgerCategoryId",
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
                        ledgerCategoryId: categoryProperty,
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

/** AIへ渡す、選べるカテゴリの一覧（「id: 大分類 / 中分類」）。 */
export function buildCategoryGuide(categories: ReceiptCategoryOption[]): string {
    if (categories.length === 0) {
        return "家計簿のカテゴリがまだ無いため、ledgerCategoryId はすべて null にしてください。"
    }
    const lines = categories.map((category) => `- ${category.ledgerCategoryId}: ${choiceLabel(category)}`)
    return [
        "商品ごとに、家計簿の支出のカテゴリ（大分類 / 中分類）を次から1つ選び、そのidを ledgerCategoryId に入れてください。",
        ...lines,
    ].join("\n")
}

export interface AnalyzeReceiptInput {
    imageBase64: string
    mimeType: SupportedImageMimeType
    categories: ReceiptCategoryOption[]
    /** 過去に確定したレシートの店舗名。表記を揃えるためのヒント。 */
    knownStoreNames?: string[]
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

    const text = extractTextContent(response)

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
                ledgerCategoryId: toNullableInteger(item.ledgerCategoryId),
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
        buildCategoryGuide(input.categories),
        storeHint,
    ]
        .filter(Boolean)
        .join("\n\n")

    const json = await requestReceiptMessage(apiKey, {
        model: getReceiptModel(),
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        output_config: {
            format: {
                type: "json_schema",
                schema: buildResponseSchema(input.categories),
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
    }, "receipt-image")
    return parseAnalysisResponse(json)
}

/**
 * Anthropic APIを1回呼ぶ。画像解析（`analyzeReceiptImage`）・メール解析・
 * 商品名の分類（`classifyItemsWithAi`）で失敗時の扱いを揃えるため、通信はここへ寄せる。
 * 通信の実体は `lib/anthropic-messages.ts` で、ここでは `ReceiptAnalysisError` へ変換するだけ。
 */
async function requestReceiptMessage(
    apiKey: string,
    body: Record<string, unknown>,
    feature: AiFeature
): Promise<AnthropicMessageResponse> {
    try {
        return await requestAnthropicMessage(apiKey, body, { label: "Receipt analysis", feature })
    } catch (error) {
        if (error instanceof AnthropicRequestError) {
            throw new ReceiptAnalysisError(
                describeAnthropicFailure(error.failure, "AIの解析に失敗しました"),
                error.cause ?? error
            )
        }
        throw error
    }
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
    categories: ReceiptCategoryOption[]
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
        buildCategoryGuide(input.categories),
        "本文:\n" + input.body,
    ]
        .filter(Boolean)
        .join("\n\n")

    const json = await requestReceiptMessage(apiKey, {
        model: getReceiptModel(),
        max_tokens: 16000,
        system: MAIL_SYSTEM_PROMPT,
        output_config: {
            format: {
                type: "json_schema",
                schema: buildResponseSchema(input.categories),
            },
        },
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    }, "receipt-mail")

    return parseAnalysisResponse(json)
}

const CLASSIFY_SYSTEM_PROMPT = [
    "あなたは家計簿の商品名を、指定された支出のカテゴリ（大分類 / 中分類）へ分類するアシスタントです。",
    "商品名から判断できる範囲で分類し、判断できない場合は ledgerCategoryId を null にしてください。",
    "confidence は 0.0〜1.0 で、商品名だけではカテゴリを1つに絞れない場合ほど低くします。",
    "略語・型番だけの商品名や、複数のカテゴリにまたがりうる商品名は、無理に分類せず低い confidence を返してください。",
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
    ledgerCategoryId: number | null
    confidence: number
}

export interface ClassifyItemsInput {
    items: ClassifiableSourceItem[]
    storeName: string | null
    categories: ReceiptCategoryOption[]
    /** 「スマートレシート」「Amazon」など、明細の出どころ。分類のヒントになる。 */
    sourceLabel?: string
}

function buildClassificationSchema(categories: ReceiptCategoryOption[]): Record<string, unknown> {
    const categoryProperty = buildCategoryIdProperty(categories)

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
                    required: ["index", "ledgerCategoryId", "confidence"],
                    properties: {
                        index: {
                            type: "integer",
                            description: "入力した商品リストの番号（0始まり）。",
                        },
                        ledgerCategoryId: categoryProperty,
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
            ledgerCategoryId: toNullableInteger(entry.ledgerCategoryId),
            confidence: toConfidence(entry.confidence),
        })
    }

    return Array.from({ length: itemCount }, (_, index) => {
        // 返ってこなかった商品は「分類できなかった」として扱う。確認待ちに落ちる。
        return byIndex.get(index) ?? { index, ledgerCategoryId: null, confidence: 0 }
    })
}

export function parseClassificationResponse(
    response: AnthropicMessageResponse,
    itemCount: number
): AiClassifiedItem[] {
    if (response.stop_reason === "refusal") {
        throw new ReceiptAnalysisError("AIが分類を拒否しました")
    }

    const text = extractTextContent(response)

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
 * 商品名だけを手がかりに家計簿のカテゴリへ分類する（Issue #222。#843 でZaimの内訳から家計簿のカテゴリへ）。
 *
 * スマートレシート・Amazon由来の明細には画像が無いため、画像解析（`analyzeReceiptImage`）は使えない。
 * 分類履歴で決まらなかった商品だけをここへ渡す前提で、呼び出し回数を抑えている。
 */
export async function classifyItemsWithAi(input: ClassifyItemsInput): Promise<AiClassifiedItem[]> {
    if (input.items.length === 0) return []

    const apiKey = getAnthropicApiKey()
    if (!apiKey) {
        throw new ReceiptAnalysisError(
            "ANTHROPIC_API_KEY が設定されていないため、カテゴリを分類できません"
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
        "次の商品をそれぞれ家計簿のカテゴリへ分類し、指定されたJSON形式で返してください。",
        context,
        buildCategoryGuide(input.categories),
        "商品:\n" + itemLines,
    ]
        .filter(Boolean)
        .join("\n\n")

    const json = await requestReceiptMessage(apiKey, {
        model: getReceiptModel(),
        max_tokens: 8000,
        system: CLASSIFY_SYSTEM_PROMPT,
        output_config: {
            format: {
                type: "json_schema",
                schema: buildClassificationSchema(input.categories),
            },
        },
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    }, "receipt-classify")

    return parseClassificationResponse(json, input.items.length)
}

const SUGGEST_SYSTEM_PROMPT = [
    "あなたは家計簿の商品名について、当てはまりそうな支出のカテゴリ（大分類 / 中分類）の候補を挙げるアシスタントです。",
    "最も当てはまるものから順に、最大3件まで返してください。無理に3件へ揃えず、確からしいものだけで構いません。",
    "reason は、なぜそのカテゴリが当てはまるかを30文字以内の日本語で書きます。",
    "商品名から判断できない場合は candidates を空にしてください。",
].join("\n")

export interface CategoryCandidate {
    ledgerCategoryId: number
    reason: string
}

/** 利用者へ見せる候補の上限。 */
export const CATEGORY_CANDIDATE_LIMIT = 3

export interface SuggestCategoriesInput {
    rawName: string
    amount: number | null
    storeName: string | null
    categories: ReceiptCategoryOption[]
}

function buildSuggestionSchema(categories: ReceiptCategoryOption[]): Record<string, unknown> {
    return {
        type: "object",
        additionalProperties: false,
        required: ["candidates"],
        properties: {
            candidates: {
                type: "array",
                description: `当てはまりそうな順に最大${CATEGORY_CANDIDATE_LIMIT}件。`,
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ledgerCategoryId", "reason"],
                    properties: {
                        ledgerCategoryId: {
                            type: "integer",
                            enum: categories.map((category) => category.ledgerCategoryId),
                            description: "候補にするカテゴリのid。",
                        },
                        reason: { type: "string", description: "そのカテゴリを挙げた理由。30文字以内。" },
                    },
                },
            },
        },
    }
}

/**
 * AIの候補を整える。存在しないカテゴリ・重複は落とし、上限で切る（`maxItems` はスキーマで使えないため、ここで切る）。
 */
export function normalizeCategoryCandidates(parsed: unknown, validCategoryIds: number[]): CategoryCandidate[] {
    const raw = (parsed ?? {}) as { candidates?: unknown }
    const rows = Array.isArray(raw.candidates) ? raw.candidates : []
    const valid = new Set(validCategoryIds)
    const seen = new Set<number>()
    const result: CategoryCandidate[] = []

    for (const row of rows) {
        const entry = (row ?? {}) as Record<string, unknown>
        const id = toNullableInteger(entry.ledgerCategoryId)
        if (id === null || !valid.has(id) || seen.has(id)) continue
        seen.add(id)
        result.push({ ledgerCategoryId: id, reason: typeof entry.reason === "string" ? entry.reason.trim().slice(0, 60) : "" })
        if (result.length >= CATEGORY_CANDIDATE_LIMIT) break
    }
    return result
}

/**
 * 1つの商品について、カテゴリの候補を最大3件返す。利用者が「AIに聞く」を押したときだけ呼ぶ（#686）。
 */
export async function suggestCategoriesWithAi(input: SuggestCategoriesInput): Promise<CategoryCandidate[]> {
    if (input.categories.length === 0) return []

    const apiKey = getAnthropicApiKey()
    if (!apiKey) {
        throw new ReceiptAnalysisError("ANTHROPIC_API_KEY が設定されていないため、AIに聞けません")
    }

    const prompt = [
        "次の商品に当てはまりそうな家計簿のカテゴリを、指定されたJSON形式で返してください。",
        input.storeName ? "店舗名: " + input.storeName : "",
        buildCategoryGuide(input.categories),
        "商品: " + input.rawName + (input.amount === null ? "" : `（${input.amount}円）`),
    ]
        .filter(Boolean)
        .join("\n\n")

    const json = await requestReceiptMessage(apiKey, {
        model: getReceiptModel(),
        max_tokens: 2000,
        system: SUGGEST_SYSTEM_PROMPT,
        output_config: { format: { type: "json_schema", schema: buildSuggestionSchema(input.categories) } },
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    }, "genre-suggest")

    if (json.stop_reason === "refusal") throw new ReceiptAnalysisError("AIが候補の提示を拒否しました")
    const text = extractTextContent(json)
    if (!text.trim()) throw new ReceiptAnalysisError("AIから候補が返りませんでした")

    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch (error) {
        throw new ReceiptAnalysisError("AIの候補を解釈できませんでした", error)
    }
    return normalizeCategoryCandidates(parsed, input.categories.map((category) => category.ledgerCategoryId))
}
