import { redirect } from "next/navigation"

import { AgentApprovalForm } from "@/components/payroll/agent-approval-form"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getCurrentUserId } from "@/lib/auth"
import { meisaiClosedMessage } from "@/lib/meisai-cutover"
import { getApprovalForScreen } from "@/lib/payroll/agent-approval-server"
import type { ApprovalStatus } from "@/lib/payroll/agent-approval"

export const dynamic = "force-dynamic"

const STATUS_LABELS: Record<ApprovalStatus, string> = {
    pending: "承認待ち",
    approved: "承認済み（登録待ち）",
    rejected: "却下済み",
    consumed: "登録に使用済み",
    expired: "期限切れ",
}

const KIND_LABELS: Record<string, string> = {
    value: "項目",
    grossTotal: "総支給",
    netTotal: "差引支給",
    subtotal: "小計",
    skip: "反映しない",
}

const yen = (value: number | null) => (value === null ? "—" : `${value.toLocaleString()} 円`)

// 給与明細の代理登録（Issue #798）: AIDEが読んだプレビューを、本人が確かめて承認・却下する画面。
// ログイン済みの本人の記録だけを開ける。承認するまで、代理登録の commit は保存しない
export default async function SalaryAgentApprovalPage({ params }: { params: Promise<{ previewId: string }> }) {
    const userId = await getCurrentUserId()
    if (!userId) redirect("/login")
    if (meisaiClosedMessage()) redirect("/")

    const { previewId } = await params
    const data = await getApprovalForScreen(userId, previewId)
    if (!data) {
        return (
            <div className="pt-4">
                <Card>
                    <CardHeader>
                        <CardTitle>承認する給与明細が見つかりません</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                        リンクが正しくないか、別のアカウントのプレビューです。もう一度プレビューを作り直してください。
                    </CardContent>
                </Card>
            </div>
        )
    }

    const { summary, status } = data
    const decided = status !== "pending"
    const month = summary?.year && summary?.month ? `${summary.year}-${String(summary.month).padStart(2, "0")}` : null

    return (
        <div className="space-y-4 pt-4">
            <Card>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                    <CardTitle>給与明細の登録を承認する</CardTitle>
                    <Badge variant={status === "pending" ? "default" : "secondary"}>{STATUS_LABELS[status]}</Badge>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-muted-foreground">
                    <p>AIDEが読み取った内容です。確かめて、問題がなければ承認してください。承認するまで給与には登録されません。</p>
                    <p>有効期限: {new Date(data.expiresAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</p>
                </CardContent>
            </Card>

            {summary ? (
                <>
                    <Card>
                        <CardHeader>
                            <CardTitle>内容{month ? `（${summary.year}年${summary.month}月分）` : ""}</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                                <div>
                                    <dt className="text-muted-foreground">総支給（計算値）</dt>
                                    <dd className="font-medium">{yen(summary.totals.computed.grossSalary)}</dd>
                                </div>
                                <div>
                                    <dt className="text-muted-foreground">手取り（計算値）</dt>
                                    <dd className="font-medium">{yen(summary.totals.computed.netSalary)}</dd>
                                </div>
                                <div>
                                    <dt className="text-muted-foreground">明細の総支給</dt>
                                    <dd>{yen(summary.totals.pdf.grossTotal)}</dd>
                                </div>
                                <div>
                                    <dt className="text-muted-foreground">明細の差引支給</dt>
                                    <dd>{yen(summary.totals.pdf.netTotal)}</dd>
                                </div>
                            </dl>
                            <ul className="divide-y rounded-md border text-sm">
                                {summary.lines.map((line, index) => (
                                    <li key={`${line.label}-${index}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                                        <span className="min-w-0">
                                            <span className="mr-2 text-xs text-muted-foreground">{KIND_LABELS[line.kind] ?? line.kind}</span>
                                            {line.label}
                                            {line.destinationLabel ? (
                                                <span className="ml-2 text-xs text-muted-foreground">→ {line.destinationLabel}</span>
                                            ) : null}
                                        </span>
                                        <span className="tabular-nums">{yen(line.amount)}</span>
                                    </li>
                                ))}
                            </ul>
                            {summary.unassignedLabels.length > 0 ? (
                                <p className="text-sm text-destructive">未割当の項目: {summary.unassignedLabels.join("、")}</p>
                            ) : null}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>登録済みの明細との関係</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            {summary.existing.alreadyImportedSalaryId ? (
                                <p className="text-destructive">このメールの明細はすでに登録済みです。承認しても上書きしません。</p>
                            ) : null}
                            {summary.existing.sameMonthSalaries.length === 0 ? (
                                <p className="text-muted-foreground">同じ月に登録済みの給与明細はありません。</p>
                            ) : (
                                <p className="text-muted-foreground">
                                    同じ月の登録済み明細（支給日）: {summary.existing.sameMonthSalaries.map((salary) => salary.salaryDate).join("、")}
                                    。同じ支給日では登録できません。
                                </p>
                            )}
                            {summary.blockers.map((blocker) => (
                                <p key={blocker.code} className="text-destructive">
                                    {blocker.message}
                                </p>
                            ))}
                        </CardContent>
                    </Card>

                    {decided ? (
                        <Card>
                            <CardContent className="pt-6 text-sm">
                                {status === "approved"
                                    ? `承認済みです。支給日 ${data.salaryDate ?? "—"} で登録できます。`
                                    : STATUS_LABELS[status]}
                            </CardContent>
                        </Card>
                    ) : (
                        <Card>
                            <CardContent className="pt-6">
                                <AgentApprovalForm
                                    previewId={data.previewId}
                                    initialSalaryDate={summary.salaryDateCandidate ?? ""}
                                    month={month}
                                    canApprove={summary.canSave}
                                />
                            </CardContent>
                        </Card>
                    )}
                </>
            ) : (
                <Card>
                    <CardContent className="pt-6 text-sm text-muted-foreground">
                        {status === "expired"
                            ? "有効期限が切れました。もう一度プレビューを作り直してください。"
                            : `この承認は「${STATUS_LABELS[status]}」です。`}
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
