// 給与明細の代理登録の本人承認（Issue #798）で、承認画面が使うDB処理。サーバー専用。
// PDFの解析（pdf.js）を持つ agent-import-server.ts とは分け、画面のサーバーアクションから軽く読めるようにしている。
// ログには previewId とステータスだけを残す（金額・項目名は出さない）。
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"
import {
    canApproveSummary,
    parseApprovalSummary,
    resolveApprovalStatus,
    type ApprovalStatus,
    type ApprovalSummary,
} from "@/lib/payroll/agent-approval"

export type ApprovalScreenData = {
    previewId: string
    status: ApprovalStatus
    expiresAt: string
    salaryDate: string | null
    /** 期限切れ・消費・却下のときは null（金額を持ち続けない） */
    summary: ApprovalSummary | null
}

/** 承認画面に出す内容。本人の記録だけ読める（他ユーザー・存在しないIDは null） */
export async function getApprovalForScreen(
    userId: string,
    previewId: string,
    now: number = Date.now()
): Promise<ApprovalScreenData | null> {
    const record = await prisma.salaryAgentApproval.findFirst({
        where: { id: previewId, userId },
        select: { status: true, expiresAt: true, salaryDate: true, summary: true },
    })
    if (!record) return null
    const status = resolveApprovalStatus(record, now)
    return {
        previewId,
        status,
        expiresAt: record.expiresAt.toISOString(),
        salaryDate: record.salaryDate,
        // 期限切れの要約は preview 時の掃除まで残りうるので、画面にも出さない
        summary: status === "pending" || status === "approved" ? parseApprovalSummary(record.summary) : null,
    }
}

export type DecideApprovalResult = { success: true; status: "approved" | "rejected" } | { success: false; error: string }

const NOT_PENDING_MESSAGES: Record<Exclude<ApprovalStatus, "pending">, string> = {
    approved: "すでに承認済みです",
    rejected: "すでに却下済みです",
    consumed: "この承認はすでに使われています",
    expired: "有効期限が切れました。もう一度プレビューを作り直してください",
}

/**
 * 本人が承認・却下する。承認は1回限り（pending のときだけ）・期限付き・内容ハッシュに紐付く記録への操作。
 * 承認では支給日（明細と同じ年月）を確定して記録する。条件付きの更新なので、二重の操作は片方しか通らない。
 */
export async function decideApproval(
    userId: string,
    previewId: string,
    decision: "approve" | "reject",
    salaryDate: unknown,
    now: number = Date.now()
): Promise<DecideApprovalResult> {
    const record = await prisma.salaryAgentApproval.findFirst({
        where: { id: previewId, userId },
        select: { status: true, expiresAt: true, summary: true },
    })
    if (!record) return { success: false, error: "対象のプレビューが見つかりません" }
    const current = resolveApprovalStatus(record, now)
    if (current !== "pending") return { success: false, error: NOT_PENDING_MESSAGES[current] }

    const pending = { id: previewId, userId, status: "pending", expiresAt: { gt: new Date(now) } }
    if (decision === "reject") {
        const result = await prisma.salaryAgentApproval.updateMany({
            where: pending,
            data: { status: "rejected", decidedAt: new Date(now), summary: Prisma.DbNull },
        })
        if (result.count !== 1) return { success: false, error: "すでに決定済みか、有効期限が切れました" }
        console.info(`[salary-agent] 承認を却下しました previewId=${previewId} status=rejected`)
        return { success: true, status: "rejected" }
    }

    const summary = parseApprovalSummary(record.summary)
    if (!summary) return { success: false, error: "承認する内容を読み込めませんでした。プレビューを作り直してください" }
    if (!summary.canSave) return { success: false, error: "この明細は登録できない内容のため、承認できません" }
    if (!canApproveSummary(summary, salaryDate)) {
        return { success: false, error: "支給日は、明細と同じ年月の日付（実在する日）を指定してください" }
    }
    const result = await prisma.salaryAgentApproval.updateMany({
        where: pending,
        data: { status: "approved", salaryDate: salaryDate as string, decidedAt: new Date(now) },
    })
    if (result.count !== 1) return { success: false, error: "すでに決定済みか、有効期限が切れました" }
    console.info(`[salary-agent] 承認しました previewId=${previewId} status=approved`)
    return { success: true, status: "approved" }
}
