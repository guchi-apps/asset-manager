/**
 * リバランスの根拠をClaudeと一緒に考える（Issue #397）。
 *
 * 画面が出しているズレ・提案・直近の値動きと投資プロフィールを文章にして渡し、
 * 「いま動く根拠」「見送る理由」「あなたに合う配分」「判断に足りない質問」を
 * JSON Schema で構造化して返させる。質問に答える追記は同じ文脈の多ターンで扱う。
 *
 * DBアクセス・Reactを持ち込まず、文脈の組み立て・スキーマ・応答の正規化・API呼び出しだけを置く。
 * 通信は `lib/anthropic-messages.ts`。
 */

import {
    AnthropicRequestError,
    describeAnthropicFailure,
    extractTextContent,
    requestAnthropicMessage,
    type AnthropicMessageResponse,
} from "@/lib/anthropic-messages"
import type { AllocationRow, ProposalMode } from "@/lib/rebalance"

export const DEFAULT_ADVICE_MODEL = "claude-opus-5"

export function getAdviceModel(): string {
    return process.env.ANTHROPIC_ADVICE_MODEL || DEFAULT_ADVICE_MODEL
}

export class RebalanceAdviceError extends Error {
    constructor(
        message: string,
        readonly cause?: unknown
    ) {
        super(message)
        this.name = "RebalanceAdviceError"
    }
}

// ---------------------------------------------------------------------------
// 投資プロフィール
// ---------------------------------------------------------------------------

export const RISK_TOLERANCES = ["low", "medium", "high"] as const
export type RiskTolerance = (typeof RISK_TOLERANCES)[number]

export const RISK_TOLERANCE_LABELS: Record<RiskTolerance, string> = {
    low: "低",
    medium: "中",
    high: "高",
}

export function isRiskTolerance(value: unknown): value is RiskTolerance {
    return typeof value === "string" && (RISK_TOLERANCES as readonly string[]).includes(value)
}

/** `User` に持つ投資プロフィール。いずれも任意。 */
export interface InvestmentProfile {
    birthYear: number | null
    retirementAge: number | null
    riskTolerance: RiskTolerance | null
    /** 自由記述（大きな出費の予定など） */
    investmentNote: string | null
}

export const EMPTY_INVESTMENT_PROFILE: InvestmentProfile = {
    birthYear: null,
    retirementAge: null,
    riskTolerance: null,
    investmentNote: null,
}

export function hasInvestmentProfile(profile: InvestmentProfile): boolean {
    return (
        profile.birthYear != null ||
        profile.retirementAge != null ||
        profile.riskTolerance != null ||
        Boolean(profile.investmentNote?.trim())
    )
}

/** 生年から今年の年齢（誕生日前後の1歳差は無視する）。 */
export function ageFromBirthYear(birthYear: number | null, now = new Date()): number | null {
    if (birthYear == null || !Number.isFinite(birthYear)) return null
    const age = now.getFullYear() - birthYear
    return age >= 0 && age <= 130 ? age : null
}

// ---------------------------------------------------------------------------
// Claude へ渡す文脈
// ---------------------------------------------------------------------------

export interface AdviceRowContext {
    key: string
    name: string
    currentValue: number
    currentRatio: number
    targetRatio: number | null
    driftPt: number | null
    diffValue: number | null
    isExcluded: boolean
    isUnassigned: boolean
    /** カテゴリ軸だけ分かる。タグ軸は null */
    kind: "investment" | "cash" | null
    /**
     * 直近の値動き（入出金を除いた評価額の差）。記録は日次で揃わないため「30日前との差」ではなく、
     * 30日以上前の記録があればそれとの差、無ければ直前の記録との差で、何日ぶんかを `days` に持つ
     * （`mapCategoriesFromRows` の monthly / daily と同じ）。分からない行は null。
     */
    change: { amount: number; rate: number; days: number } | null
}

export interface AdviceProposalContext {
    mode: ProposalMode
    extraAmount: number
    items: { name: string; amount: number }[]
    maxDriftBefore: number
    maxDriftAfter: number
    shortfallTotal: number
}

export interface RebalanceAdviceContext {
    /** 「カテゴリ別」「資産クラス」など */
    axisLabel: string
    /** JST の YYYY-MM-DD */
    today: string
    totalValue: number
    excludedValue: number
    excludedCount: number
    /** 「要調整」と判定するズレ（pt） */
    threshold: number
    rows: AdviceRowContext[]
    proposal: AdviceProposalContext
    /** 積立自動登録（有効なもの）の毎月の合計。登録が無ければ null */
    monthlyDeposit: number | null
    profile: InvestmentProfile
}

function yen(value: number): string {
    return Math.round(value).toLocaleString("ja-JP") + "円"
}

function pct(value: number): string {
    return (Math.round(value * 10) / 10).toFixed(1) + "%"
}

function signedPt(value: number): string {
    const rounded = Math.round(value * 10) / 10
    return (rounded > 0 ? "+" : "") + rounded.toFixed(1) + "pt"
}

function signedYen(value: number): string {
    return (value > 0 ? "+" : "") + yen(value)
}

function describeChange(change: AdviceRowContext["change"]): string {
    if (!change) return "値動き: 不明（比べられる記録が無い）"
    const rate = (change.rate > 0 ? "+" : "") + (Math.round(change.rate * 10) / 10).toFixed(1) + "%"
    return `値動き: ${signedYen(change.amount)}（${rate}・${change.days}日ぶん）`
}

/** 配分の提案対象になる行（目標を持てる行）。未分類・対象外は含めない。 */
export function assignableRows<T extends Pick<AllocationRow, "id" | "isUnassigned" | "isExcluded">>(rows: T[]): T[] {
    return rows.filter((row) => row.id != null && !row.isUnassigned && !row.isExcluded)
}

export function describeProfile(profile: InvestmentProfile, monthlyDeposit: number | null, now = new Date()): string {
    const lines: string[] = []
    const age = ageFromBirthYear(profile.birthYear, now)
    if (age != null) {
        lines.push(`- 年齢: ${age}歳（${profile.birthYear}年生まれ）`)
    } else {
        lines.push("- 年齢: 未登録")
    }
    if (profile.retirementAge != null) {
        const remain = age != null ? profile.retirementAge - age : null
        lines.push(
            `- リタイア予定: ${profile.retirementAge}歳` +
                (remain != null ? `（あと${Math.max(0, remain)}年）` : "")
        )
    } else {
        lines.push("- リタイア予定: 未登録")
    }
    lines.push(
        "- リスク許容度: " +
            (profile.riskTolerance ? RISK_TOLERANCE_LABELS[profile.riskTolerance] : "未登録")
    )
    lines.push(
        "- 毎月の積立: " + (monthlyDeposit != null && monthlyDeposit > 0 ? yen(monthlyDeposit) : "登録なし")
    )
    const note = profile.investmentNote?.trim()
    if (note) lines.push("- 本人の補足: " + note.replace(/\s+/g, " ").slice(0, 500))
    return lines.join("\n")
}

/** 画面の数値を、Claude が読む文章にする。 */
export function buildContextText(context: RebalanceAdviceContext): string {
    const active = context.rows.filter((row) => !row.isExcluded)
    const excluded = context.rows.filter((row) => row.isExcluded)
    const targeted = active.filter((row) => row.targetRatio != null)
    const overThreshold = targeted.filter(
        (row) => Math.round(Math.abs(row.driftPt ?? 0) * 10) / 10 >= context.threshold
    )

    const rowLines = active.map((row) => {
        const head = `- ${row.name}（key: ${row.key}）`
        const parts = [
            `評価額 ${yen(row.currentValue)}`,
            `現在 ${pct(row.currentRatio)}`,
            row.targetRatio != null ? `目標 ${pct(row.targetRatio)}` : "目標なし",
            row.driftPt != null ? `ズレ ${signedPt(row.driftPt)}` : null,
            row.diffValue != null ? `目標額との差 ${signedYen(row.diffValue)}` : null,
            row.kind === "cash" ? "種別: 現金・預金" : row.kind === "investment" ? "種別: 投資" : null,
            row.isUnassigned ? "どのタグにも属さない資産（目標は設定できない）" : null,
            describeChange(row.change),
        ].filter((part): part is string => Boolean(part))
        return head + ": " + parts.join("、")
    })

    const excludedLines = excluded.map(
        (row) => `- ${row.name}（key: ${row.key}）: 評価額 ${yen(row.currentValue)}。本人の指定で計算から外している`
    )

    const proposal = context.proposal
    const proposalLines: string[] = [
        `- モード: ${proposal.mode === "buyOnly" ? "買い増しのみ（売らない）" : "売買あり（目標ちょうどに合わせる）"}`,
        `- 追加で投資できる金額: ${proposal.extraAmount > 0 ? yen(proposal.extraAmount) : "未入力"}`,
    ]
    if (proposal.items.length) {
        proposalLines.push(
            "- 画面の提案: " +
                proposal.items.map((item) => `${item.name} ${signedYen(item.amount)}`).join("、")
        )
        proposalLines.push(
            `- 提案どおりに動かした後の最大のズレ: ${signedPt(proposal.maxDriftBefore).replace("+", "")} → ${signedPt(proposal.maxDriftAfter).replace("+", "")}`
        )
    } else {
        proposalLines.push("- 画面の提案: なし（金額未入力、または動かす必要なし）")
    }
    if (proposal.mode === "buyOnly" && proposal.shortfallTotal > 0) {
        proposalLines.push(`- 目標に届かせるために必要な買い増しの合計（不足額）: ${yen(proposal.shortfallTotal)}`)
    }

    const sections = [
        `今日: ${context.today}`,
        `集計軸: ${context.axisLabel}`,
        `対象総資産（負債と対象外を除く）: ${yen(context.totalValue)}` +
            (context.excludedCount > 0
                ? `（対象外 ${context.excludedCount}件・${yen(context.excludedValue)} を差し引いた額）`
                : ""),
        `「要調整」と判定するズレのしきい値: ${context.threshold}pt。` +
            (targeted.length
                ? `しきい値以上の項目: ${overThreshold.length ? overThreshold.map((r) => r.name).join("、") : "なし"}`
                : "目標配分はまだ設定されていない"),
        "## 項目ごとの状況\n" + (rowLines.length ? rowLines.join("\n") : "（項目なし）"),
        excludedLines.length ? "## 計算から外している項目\n" + excludedLines.join("\n") : null,
        "## 画面の提案\n" + proposalLines.join("\n"),
        "## 投資プロフィール\n" + describeProfile(context.profile, context.monthlyDeposit),
        "## 注意\n" +
            [
                "- 値動きは「30日前との差」ではない。記録は毎日は揃わないため、比べられる記録との差を何日ぶんかを添えて書いている。1日ぶんの変動として扱わないこと。",
                "- 配分の提案は上の「項目ごとの状況」にある key のうち、目標なし以外も含めた**目標を設定できる項目すべて**に対して合計100%で返す。未分類・計算から外した項目は対象外。",
            ].join("\n"),
    ].filter((section): section is string => Boolean(section))

    return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// 応答のスキーマと正規化
// ---------------------------------------------------------------------------

export const ADVICE_VERDICTS = ["act", "partial", "hold", "undecided"] as const
export type AdviceVerdict = (typeof ADVICE_VERDICTS)[number]

export interface AdvicePoint {
    title: string
    detail: string
}

export interface AllocationSuggestionItem {
    key: string
    name: string
    /** 現在保存されている目標（%）。未設定は null */
    currentTarget: number | null
    /** 提案する目標（%）。0.1刻み・合計100 */
    ratio: number
    reason: string
}

export interface AllocationSuggestion {
    items: AllocationSuggestionItem[]
    /** どういう前提で組んだか（年齢・リスク許容度など）の一文 */
    basis: string
}

export interface RebalanceAdvice {
    verdict: AdviceVerdict
    /** 結論の見出し（「買い増しで寄せる。売却は急がない」など） */
    verdictLabel: string
    headline: string
    reasons: AdvicePoint[]
    cautions: AdvicePoint[]
    /** 配分の提案。目標を設定できる項目が無いときは null */
    allocation: AllocationSuggestion | null
    /** 判断のために本人へ聞きたいこと（0〜3件） */
    questions: string[]
}

const POINT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["title", "detail"],
    properties: {
        title: { type: "string", description: "20字程度の見出し。" },
        detail: {
            type: "string",
            description: "根拠となる数値を含めた1〜3文。文脈に無い数値を作らない。",
        },
    },
} as const

/**
 * 応答のスキーマ。配分の提案は「目標を設定できる行」を必須プロパティにして、
 * 一部の項目だけを返せない形にする（欠けた項目が0%として保存されるのを防ぐ）。
 */
export function buildAdviceSchema(assignable: { key: string; name: string }[]): Record<string, unknown> {
    const allocationSchema: Record<string, unknown> = assignable.length
        ? {
              type: ["object", "null"],
              additionalProperties: false,
              required: ["basis", "ratios"],
              description:
                  "本人に合う目標配分。目標を設定できる項目すべてに対して、合計が100になるように返す。",
              properties: {
                  basis: {
                      type: "string",
                      description: "どの前提（年齢・リタイアまでの年数・リスク許容度・積立）から組んだかの一文。",
                  },
                  ratios: {
                      type: "object",
                      additionalProperties: false,
                      required: assignable.map((row) => row.key),
                      properties: Object.fromEntries(
                          assignable.map((row) => [
                              row.key,
                              {
                                  type: "object",
                                  additionalProperties: false,
                                  required: ["ratio", "reason"],
                                  description: `${row.name} の提案。`,
                                  properties: {
                                      ratio: { type: "number", description: "提案する目標比率（%）。0.1刻み。" },
                                      reason: { type: "string", description: "その比率にする理由を1文で。" },
                                  },
                              },
                          ])
                      ),
                  },
              },
          }
        : { type: "null", description: "目標を設定できる項目が無いため、必ず null を返す。" }

    return {
        type: "object",
        additionalProperties: false,
        required: ["verdict", "verdictLabel", "headline", "reasons", "cautions", "allocation", "questions"],
        properties: {
            verdict: {
                type: "string",
                enum: [...ADVICE_VERDICTS],
                description:
                    "act=いま動く根拠が十分、partial=一部だけ動かす（買い増しで寄せる など）、hold=様子見でよい、undecided=本人の回答が無いと決められない。",
            },
            verdictLabel: { type: "string", description: "結論を20字以内で。例「買い増しで寄せる。売却は急がない」" },
            headline: {
                type: "string",
                description: "結論の説明。2〜3文。しきい値を超えている項目と、それをどう扱うかを数値で書く。",
            },
            // 件数の上限は description で伝え、正規化で切る（構造化出力は maxItems を受け付けない）
            reasons: {
                type: "array",
                description: "いま動く根拠。数値を伴うものだけを最大4件。無ければ空配列。",
                items: POINT_SCHEMA,
            },
            cautions: {
                type: "array",
                description: "見送る理由・注意点を最大4件。目標配分そのものの見直し余地もここに書く。",
                items: POINT_SCHEMA,
            },
            allocation: allocationSchema,
            questions: {
                type: "array",
                description: "答えが判断を変える質問だけを最大3件。既に本人が答えたことは聞き直さない。",
                items: { type: "string" },
            },
        },
    }
}

function toText(value: unknown, max = 2000): string {
    return typeof value === "string" ? value.trim().slice(0, max) : ""
}

function toPoints(value: unknown, max: number): AdvicePoint[] {
    if (!Array.isArray(value)) return []
    return value
        .map((entry) => {
            const raw = (entry ?? {}) as Record<string, unknown>
            const title = toText(raw.title, 200)
            const detail = toText(raw.detail)
            if (!title && !detail) return null
            return { title: title || detail.slice(0, 40), detail }
        })
        .filter((point): point is AdvicePoint => point !== null)
        .slice(0, max)
}

function roundRatio(value: number): number {
    return Math.round(value * 10) / 10
}

/**
 * 配分の提案を、現在の軸で目標を設定できる行の集合へ射影する。
 * - 未分類・対象外・知らない key は落とす
 * - 提案に無い行は、いまの目標を残す（無ければ0）。新しく0を入れて全額売却の提案にしない
 * - 0.1刻みに丸め、合計が100になるよう差を最大の行で吸収する
 * 設定できる行が無い、または合計が0のときは null。
 */
export function normalizeAllocationSuggestion(
    parsed: unknown,
    rows: Pick<AllocationRow, "key" | "id" | "name" | "targetRatio" | "isUnassigned" | "isExcluded">[]
): AllocationSuggestion | null {
    const assignable = assignableRows(rows)
    if (!assignable.length || parsed == null || typeof parsed !== "object") return null

    const raw = parsed as Record<string, unknown>
    const ratios = (raw.ratios ?? {}) as Record<string, unknown>

    const items: AllocationSuggestionItem[] = assignable.map((row) => {
        const entry = (ratios[row.key] ?? null) as Record<string, unknown> | null
        const proposed =
            entry && typeof entry.ratio === "number" && Number.isFinite(entry.ratio)
                ? Math.min(100, Math.max(0, entry.ratio))
                : (row.targetRatio ?? 0)
        return {
            key: row.key,
            name: row.name,
            currentTarget: row.targetRatio != null ? roundRatio(row.targetRatio) : null,
            ratio: roundRatio(proposed),
            reason: entry ? toText(entry.reason, 400) : "",
        }
    })

    const sum = roundRatio(items.reduce((acc, item) => acc + item.ratio, 0))
    if (sum <= 0) return null

    // 合計100からのズレは、比率が最も大きい行で吸収する（編集ダイアログの初期値と同じ流儀）
    const diff = roundRatio(100 - sum)
    if (diff !== 0) {
        let largest = 0
        for (let i = 1; i < items.length; i++) {
            if (items[i].ratio > items[largest].ratio) largest = i
        }
        items[largest] = { ...items[largest], ratio: roundRatio(items[largest].ratio + diff) }
    }

    return { items, basis: toText(raw.basis, 400) }
}

export function normalizeAdvice(
    parsed: unknown,
    rows: Pick<AllocationRow, "key" | "id" | "name" | "targetRatio" | "isUnassigned" | "isExcluded">[]
): RebalanceAdvice {
    const raw = (parsed ?? {}) as Record<string, unknown>
    const verdict = (ADVICE_VERDICTS as readonly string[]).includes(raw.verdict as string)
        ? (raw.verdict as AdviceVerdict)
        : "undecided"
    const questions = Array.isArray(raw.questions)
        ? raw.questions.map((q) => toText(q, 300)).filter(Boolean).slice(0, 3)
        : []

    return {
        verdict,
        verdictLabel: toText(raw.verdictLabel, 60) || "見立て",
        headline: toText(raw.headline),
        reasons: toPoints(raw.reasons, 4),
        cautions: toPoints(raw.cautions, 4),
        allocation: normalizeAllocationSuggestion(raw.allocation, rows),
        questions,
    }
}

export function parseAdviceResponse(
    response: AnthropicMessageResponse,
    rows: Pick<AllocationRow, "key" | "id" | "name" | "targetRatio" | "isUnassigned" | "isExcluded">[]
): RebalanceAdvice {
    if (response.stop_reason === "refusal") {
        throw new RebalanceAdviceError("AIが回答を見送りました。表現を変えて試してください。")
    }
    const text = extractTextContent(response)
    if (!text.trim()) {
        throw new RebalanceAdviceError("AIから見立てが返りませんでした")
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch (error) {
        throw new RebalanceAdviceError("AIの見立てを解釈できませんでした", error)
    }
    return normalizeAdvice(parsed, rows)
}

// ---------------------------------------------------------------------------
// 呼び出し
// ---------------------------------------------------------------------------

export const ADVICE_SYSTEM_PROMPT = [
    "あなたは個人の資産配分（アセットアロケーション）について、本人と一緒に考える相談相手です。",
    "渡されるのは本人が登録した資産の評価額・目標配分とのズレ・画面が計算した売買の提案・直近の値動き・投資プロフィールです。",
    "目的は「いまリバランスすべきか」の根拠と、「本人に合う目標配分」を、本人が自分で判断できる形に整理することです。",
    "",
    "守ること:",
    "- 日本語で、平易に。断定より根拠。文脈にある数値を必ず引用し、文脈に無い数値・相場観を作らない。",
    "- 登録済みの項目の中だけで考える。個別銘柄・特定の商品名・保有していない資産クラスを新たに勧めない。",
    "- 税金・手数料・口座の種類（NISA/特定口座）など、判断を変えるのに文脈に無い情報は、決めつけずに questions で本人に聞く。",
    "- 値動きは「N日ぶん」の差として扱う。1日の変動と混同しない。",
    "- 配分の提案（allocation）は、目標を設定できる項目すべてに比率を付け、合計を100にする。年齢・リタイアまでの年数・リスク許容度・積立の有無を根拠にし、プロフィールが未登録なら一般的な目安で組み、その旨を basis に書く。現在の目標を変えない項目にも理由を付ける。",
    "- 本人が追記・回答したら、見立て全体（verdict・reasons・cautions・allocation・questions）を更新して返す。変わらない部分はそのまま残し、変えた部分は headline で触れる。答えてもらったことは聞き直さない。",
    "- これは投資助言ではなく整理の手伝いであることを前提に、最終判断は本人に委ねる書き方にする。",
].join("\n")

export interface AdviceTurn {
    role: "user" | "assistant"
    /** assistant の content は、そのとき返した `RebalanceAdvice` の JSON 文字列 */
    content: string
}

export interface RequestRebalanceAdviceInput {
    apiKey: string
    context: RebalanceAdviceContext
    /** 正規化に使う行（目標を設定できる行の集合を決める） */
    rows: Pick<AllocationRow, "key" | "id" | "name" | "targetRatio" | "isUnassigned" | "isExcluded">[]
    /** これまでのやり取り。最初の呼び出しは空 */
    turns: AdviceTurn[]
    /** 今回の追記。最初の呼び出しは省略 */
    message?: string
}

/** 最初のユーザーメッセージ。文脈と依頼をまとめる。 */
export function buildOpeningMessage(context: RebalanceAdviceContext): string {
    return [
        "次の状況を読み、いまリバランスすべきかの根拠と、本人に合う目標配分を指定のJSON形式で返してください。",
        buildContextText(context),
    ].join("\n\n")
}

export function buildAdviceMessages(input: Omit<RequestRebalanceAdviceInput, "apiKey" | "rows">): { role: string; content: string }[] {
    const messages: { role: string; content: string }[] = [
        { role: "user", content: buildOpeningMessage(input.context) },
    ]
    for (const turn of input.turns) {
        if (!turn.content.trim()) continue
        messages.push({ role: turn.role, content: turn.content })
    }
    const message = input.message?.trim()
    if (message) {
        messages.push({
            role: "user",
            content:
                "本人からの追記・回答:\n" +
                message +
                "\n\nこれを踏まえて見立て全体を更新し、同じJSON形式で返してください。",
        })
    }
    // 直前がユーザーでなければ（追記無しで履歴だけ渡された場合）、更新依頼を足して user で終える
    if (messages[messages.length - 1].role !== "user") {
        messages.push({ role: "user", content: "最新の状況で見立てを更新し、同じJSON形式で返してください。" })
    }
    return messages
}

export async function requestRebalanceAdvice(input: RequestRebalanceAdviceInput): Promise<RebalanceAdvice> {
    const assignable = assignableRows(input.rows).map((row) => ({ key: row.key, name: row.name }))

    let response: AnthropicMessageResponse
    try {
        response = await requestAnthropicMessage(
            input.apiKey,
            {
                model: getAdviceModel(),
                max_tokens: 16000,
                system: ADVICE_SYSTEM_PROMPT,
                output_config: {
                    format: { type: "json_schema", schema: buildAdviceSchema(assignable) },
                },
                messages: buildAdviceMessages(input),
            },
            { label: "Rebalance advice" }
        )
    } catch (error) {
        if (error instanceof AnthropicRequestError) {
            throw new RebalanceAdviceError(
                describeAnthropicFailure(error.failure, "AIの呼び出しに失敗しました"),
                error.cause ?? error
            )
        }
        throw error
    }

    return parseAdviceResponse(response, input.rows)
}
