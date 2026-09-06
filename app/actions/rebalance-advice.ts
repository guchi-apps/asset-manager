"use server"

import { getCurrentUserId } from "@/lib/auth"
import { getAnthropicApiKey } from "@/lib/anthropic-messages"
import { getRebalanceData } from "@/app/actions/rebalance"
import { getTodayDateInput } from "@/lib/valuation-day"
import {
    buildAllocationRows,
    buildProposal,
    type ProposalMode,
    type RebalanceAxis,
} from "@/lib/rebalance"
import {
    RebalanceAdviceError,
    requestRebalanceAdvice,
    type AdviceRowContext,
    type AdviceTurn,
    type RebalanceAdvice,
} from "@/lib/rebalance-advice"

/** 1回に渡せるやり取りの上限。文脈が伸びすぎて料金と応答時間が膨らむのを防ぐ */
const MAX_TURNS = 20
const MAX_TURN_LENGTH = 20_000
const MAX_MESSAGE_LENGTH = 2_000

export interface RebalanceAdviceRequest {
    axis: RebalanceAxis
    mode: ProposalMode
    extraAmount: number
    threshold: number
    turns: AdviceTurn[]
    message?: string
}

export type RebalanceAdviceResult =
    | { success: true; advice: RebalanceAdvice }
    | { success: false; error: string }

function sanitizeAxis(axis: unknown): RebalanceAxis | null {
    const raw = (axis ?? {}) as Record<string, unknown>
    if (raw.kind === "category") return { kind: "category" }
    if (raw.kind === "tagGroup" && typeof raw.tagGroupId === "number" && Number.isFinite(raw.tagGroupId)) {
        return { kind: "tagGroup", tagGroupId: raw.tagGroupId }
    }
    return null
}

function sanitizeTurns(turns: unknown): AdviceTurn[] | null {
    if (!Array.isArray(turns)) return []
    if (turns.length > MAX_TURNS) return null
    const result: AdviceTurn[] = []
    for (const turn of turns) {
        const raw = (turn ?? {}) as Record<string, unknown>
        if ((raw.role !== "user" && raw.role !== "assistant") || typeof raw.content !== "string") return null
        if (raw.content.length > MAX_TURN_LENGTH) return null
        result.push({ role: raw.role, content: raw.content })
    }
    return result
}

/**
 * 直近の値動き。30日以上前の記録との差（monthly）があればそれを、無ければ直前の記録との差（daily）を使う。
 * 記録は日次で揃わないため、どちらも「何日ぶんか」を一緒に返す（CLAUDE.md「評価額の記録は日次で揃わない」）。
 */
function pickChange(category: {
    monthlyChange: number
    monthlyChangeRate: number
    monthlyChangeDays?: number
    dailyChange: number
    dailyChangeRate: number
    dailyChangeDays?: number
}): AdviceRowContext["change"] {
    if (category.monthlyChangeDays != null && category.monthlyChangeDays > 0 && Number.isFinite(category.monthlyChange)) {
        return { amount: category.monthlyChange, rate: category.monthlyChangeRate, days: category.monthlyChangeDays }
    }
    if (category.dailyChangeDays != null && category.dailyChangeDays > 0 && Number.isFinite(category.dailyChange)) {
        return { amount: category.dailyChange, rate: category.dailyChangeRate, days: category.dailyChangeDays }
    }
    return null
}

/**
 * 画面の状態（軸・モード・追加額・しきい値）を受け取り、サーバー側で行と提案を計算し直してから
 * Claude に渡す。クライアントが送ってきた数値をそのまま信用しないため、また
 * 直近の値動き・積立額・投資プロフィールをここで足すため。
 */
export async function requestAdvice(request: RebalanceAdviceRequest): Promise<RebalanceAdviceResult> {
    try {
        const userId = await getCurrentUserId()
        if (!userId) return { success: false, error: "ログインが必要です" }

        const apiKey = getAnthropicApiKey()
        if (!apiKey) {
            return { success: false, error: "ANTHROPIC_API_KEY が設定されていないため、AIの見立てを使えません" }
        }

        const axis = sanitizeAxis(request.axis)
        if (!axis) return { success: false, error: "集計軸の指定が不正です" }
        const mode: ProposalMode = request.mode === "buySell" ? "buySell" : "buyOnly"
        const extraAmount =
            typeof request.extraAmount === "number" && Number.isFinite(request.extraAmount)
                ? Math.max(0, Math.round(request.extraAmount))
                : 0
        const threshold =
            typeof request.threshold === "number" && Number.isFinite(request.threshold) && request.threshold > 0
                ? request.threshold
                : 5
        const turns = sanitizeTurns(request.turns)
        if (!turns) return { success: false, error: "やり取りが長すぎるか、形式が不正です。最初からやり直してください" }
        const message = typeof request.message === "string" ? request.message.trim() : ""
        if (message.length > MAX_MESSAGE_LENGTH) {
            return { success: false, error: `追記は${MAX_MESSAGE_LENGTH}文字以内で入力してください` }
        }

        const data = await getRebalanceData()
        if (!data.categories.length) {
            return { success: false, error: "資産が登録されていないため、見立てを出せません" }
        }

        const view = buildAllocationRows({
            categories: data.categories,
            tagGroups: data.tagGroups,
            targets: data.targets,
            axis,
        })
        const proposal = buildProposal({ rows: view.rows, totalValue: view.totalValue, extraAmount, mode })

        const categoryById = new Map(data.categories.map((c) => [c.id, c]))
        const rows: AdviceRowContext[] = view.rows.map((row) => {
            const category = row.categoryId != null ? categoryById.get(row.categoryId) : undefined
            return {
                key: row.key,
                name: row.name,
                currentValue: row.currentValue,
                currentRatio: row.currentRatio,
                targetRatio: row.targetRatio,
                driftPt: row.driftPt,
                diffValue: row.diffValue,
                isExcluded: row.isExcluded,
                isUnassigned: row.isUnassigned,
                kind: category ? (category.isCash ? "cash" : "investment") : null,
                change: category ? pickChange(category) : null,
            }
        })

        const axisLabel =
            axis.kind === "category"
                ? "カテゴリ別"
                : data.tagGroups.find((g) => g.id === axis.tagGroupId)?.name ?? "タグ別"

        const advice = await requestRebalanceAdvice({
            apiKey,
            rows: view.rows,
            turns,
            message: message || undefined,
            context: {
                axisLabel,
                today: getTodayDateInput(),
                totalValue: view.totalValue,
                excludedValue: view.excludedValue,
                excludedCount: view.excludedCount,
                threshold,
                rows,
                proposal: {
                    mode,
                    extraAmount,
                    items: proposal.items.map((item) => ({ name: item.name, amount: item.amount })),
                    maxDriftBefore: proposal.maxDriftBefore,
                    maxDriftAfter: proposal.maxDriftAfter,
                    shortfallTotal: proposal.shortfallTotal,
                },
                monthlyDeposit: data.monthlyDeposit,
                profile: data.profile,
            },
        })

        return { success: true, advice }
    } catch (error) {
        if (error instanceof RebalanceAdviceError) {
            return { success: false, error: error.message }
        }
        console.error("Failed to request rebalance advice:", error)
        return { success: false, error: "AIの見立ての取得に失敗しました" }
    }
}
