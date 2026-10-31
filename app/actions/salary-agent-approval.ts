"use server"

import { revalidatePath } from "next/cache"

import { getCurrentUserId } from "@/lib/auth"
import { meisaiClosedMessage } from "@/lib/meisai-cutover"
import { decideApproval, type DecideApprovalResult } from "@/lib/payroll/agent-approval-server"
import { salaryAgentApprovalPath } from "@/lib/payroll/agent-approval-paths"

/**
 * 給与明細の代理登録の承認・却下（Issue #798）。ログイン済みの本人だけが、自分宛ての記録を操作できる。
 * 記録はユーザーIDで絞って読むため、他ユーザーのプレビューIDを渡しても「見つかりません」になる。
 */
export async function decideSalaryAgentApproval(
    previewId: string,
    decision: "approve" | "reject",
    salaryDate: string
): Promise<DecideApprovalResult> {
    if (meisaiClosedMessage()) return { success: false, error: "この機能はまだ使えません" }
    const userId = await getCurrentUserId()
    if (!userId) return { success: false, error: "ログインが必要です" }
    if (typeof previewId !== "string" || (decision !== "approve" && decision !== "reject")) {
        return { success: false, error: "入力が正しくありません" }
    }
    const result = await decideApproval(userId, previewId, decision, salaryDate)
    revalidatePath(salaryAgentApprovalPath(previewId))
    return result
}
