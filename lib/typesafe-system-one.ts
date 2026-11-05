/**
 * TypeSafe の System One モデル（Jev）を呼ぶ入口（Issue #841）。
 *
 * Jev は文章を書かず、渡した選択肢から1つと確信度だけを返す（`POST /v1/systemone`）。候補に無い答えが
 * 構造上返らないため、分類に向く。yoteiflow の `src/lib/typesafe-system-one.ts`・issue-deck の
 * `src/lib/typesafe/system-one.ts` と同じ呼び方で、公式SDKは依存を増やすだけなので使わず、生の fetch で呼ぶ。
 * 失敗しても投げず null を返す（呼び出し元は未分類のまま続ける）。
 */
import { recordAiCall } from "@/lib/anthropic-messages"
import { extractUsageTokens, type AiFeature, type AnthropicUsage } from "@/lib/ai-usage"

const DEFAULT_BASE_URL = "https://api.typesafe.ai"
/** 世代を固定しないエイリアス。記録するモデル名は応答が返す実体を優先する */
const DEFAULT_MODEL = "jev-latest"
/** 判定は1秒未満で返るモデル。まとめて呼ぶので長くは待たない */
export const SYSTEM_ONE_TIMEOUT_MS = 8_000

export interface ChoiceQuestion {
    type: "choice"
    instructions?: string
    /** ラベル → 説明（説明が無ければ null） */
    criteria: Record<string, string | null>
}

export interface ChoiceResult {
    choice: string
    /** 0〜1。返らなければ null */
    confidence: number | null
    model: string
}

interface SystemOneResponse {
    model?: unknown
    answers?: Record<string, { type?: unknown; choice?: unknown; confidence?: unknown } | undefined>
    usage?: AnthropicUsage
}

/**
 * 環境変数から引く。外部サービスのAPIキーなので、issue-deck の共有トークンには置かない
 * （issue-deck の docs/shared-token-api.md #4048。1Password → GitHub secret → 本番の .env で配る）
 */
export async function typeSafeApiKey(): Promise<string | undefined> {
    return process.env.TYPESAFE_API_KEY?.trim() || undefined
}

function systemOneUrl(): string {
    // キーを持たない環境から経路だけを確かめるための差し替え口（公式SDKと同じ環境変数）
    const base = process.env.TYPESAFE_BASE_URL?.trim().replace(/\/+$/, "") || DEFAULT_BASE_URL
    return `${base}/v1/systemone`
}

/** 応答から答えを読む。読めなければ null（DBに触らない。テスト用に出す） */
export function readChoiceAnswer(json: unknown): ChoiceResult | null {
    const body = json as SystemOneResponse | null
    if (!body || typeof body !== "object" || !body.answers) return null
    const answer = body.answers.choice
    if (!answer || answer.type !== "choice" || typeof answer.choice !== "string" || !answer.choice) return null
    const confidence = typeof answer.confidence === "number" && Number.isFinite(answer.confidence) ? answer.confidence : null
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : DEFAULT_MODEL
    return { choice: answer.choice, confidence, model }
}

/** 選択肢を1つ選ばせる。キー未設定・通信失敗・応答不正は null */
export async function askChoice(options: {
    feature: AiFeature
    state: string
    question: ChoiceQuestion
    apiKey?: string
    timeoutMs?: number
}): Promise<ChoiceResult | null> {
    const apiKey = options.apiKey ?? (await typeSafeApiKey())
    if (!apiKey) return null

    let response: Response
    try {
        response = await fetch(systemOneUrl(), {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({ model: DEFAULT_MODEL, state: options.state, questions: { choice: options.question } }),
            cache: "no-store",
            signal: AbortSignal.timeout(options.timeoutMs ?? SYSTEM_ONE_TIMEOUT_MS),
        })
    } catch (error) {
        console.error("[typesafe] request failed:", error instanceof Error ? error.message : error)
        return null
    }
    if (!response.ok) {
        console.error(`[typesafe] request failed (${response.status})`)
        return null
    }
    let json: SystemOneResponse
    try {
        json = (await response.json()) as SystemOneResponse
    } catch {
        return null
    }
    // 応答が返った時点で数える。答えを読めなくても、呼び出しそのものは行われている
    const model = typeof json?.model === "string" && json.model.trim() ? json.model.trim() : DEFAULT_MODEL
    await recordAiCall({ feature: options.feature, model, ...extractUsageTokens(json?.usage) })
    return readChoiceAnswer(json)
}
