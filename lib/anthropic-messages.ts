/**
 * Claude の Messages API を呼ぶ共通部（Issue #397 で `lib/receipt-analysis.ts` から切り出した）。
 *
 * SDK（`@anthropic-ai/sdk`）を入れずに `fetch` で直接呼ぶ方針は変えていない。呼ぶのは
 * この1エンドポイントだけで、依存を増やす価値が無いため。
 *
 * ここでは「HTTP応答 → 中立なエラー」までしか扱わない。利用者向けのメッセージと例外型は
 * 呼び出し側（レシート解析は `ReceiptAnalysisError`、リバランス助言は `RebalanceAdviceError`）が
 * 決める。既存のテストがレシート側の例外型を見ているため、共通部が独自の型だけを投げる形に
 * してはいけない。
 */

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
export const ANTHROPIC_API_VERSION = "2023-06-01"

/** 未設定なら null。呼び出し側は「AI機能を使えない」として扱う。 */
export function getAnthropicApiKey(): string | null {
    return process.env.ANTHROPIC_API_KEY || null
}

export interface AnthropicTextBlock {
    type: string
    text?: string
}

export interface AnthropicMessageResponse {
    content?: AnthropicTextBlock[]
    stop_reason?: string
}

/** 通信そのものの失敗か、HTTPのエラー応答か。 */
export type AnthropicRequestFailure =
    | { kind: "network" }
    | { kind: "http"; status: number }

export class AnthropicRequestError extends Error {
    constructor(
        readonly failure: AnthropicRequestFailure,
        readonly cause?: unknown
    ) {
        super(
            failure.kind === "network"
                ? "Anthropic API request failed (network)"
                : "Anthropic API request failed (HTTP " + failure.status + ")"
        )
        this.name = "AnthropicRequestError"
    }
}

/**
 * 失敗を利用者向けの文言にする。認証・利用制限・通信不達は用途によらず同じ文言でよく、
 * それ以外だけ `fallback`（「AIの解析に失敗しました」など）に HTTP ステータスを添える。
 */
export function describeAnthropicFailure(failure: AnthropicRequestFailure, fallback: string): string {
    if (failure.kind === "network") return "AIへの接続に失敗しました"
    if (failure.status === 401 || failure.status === 403) {
        return "AIの認証に失敗しました。APIキーを確認してください。"
    }
    if (failure.status === 429) {
        return "AIの利用制限に達しました。時間をおいて再実行してください。"
    }
    return fallback + " (HTTP " + failure.status + ")"
}

export interface RequestAnthropicOptions {
    /** ログに出す用途名（例: "Receipt analysis"）。 */
    label: string
    /** ネットワークが詰まったまま待ち続けないための上限。既定は180秒。 */
    timeoutMs?: number
}

/** Anthropic API を1回呼ぶ。失敗は `AnthropicRequestError` で投げる。 */
export async function requestAnthropicMessage(
    apiKey: string,
    body: Record<string, unknown>,
    options: RequestAnthropicOptions
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
            signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
        })
    } catch (error) {
        throw new AnthropicRequestError({ kind: "network" }, error)
    }

    if (!response.ok) {
        const text = await response.text().catch(() => "")
        console.error(options.label + " failed:", response.status, text.slice(0, 500))
        throw new AnthropicRequestError({ kind: "http", status: response.status })
    }

    return (await response.json()) as AnthropicMessageResponse
}

/** 応答のテキストブロックを連結する。構造化出力でもJSONはテキストブロックとして返る。 */
export function extractTextContent(response: AnthropicMessageResponse): string {
    return (response.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("")
}
