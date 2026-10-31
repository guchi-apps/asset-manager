import { readApprovalForAgent, runSalaryAgent } from "@/lib/payroll/agent-import-server"

// 給与明細の代理登録（Issue #798）: プレビューが画面で承認されたかを読む。読み取り専用で、状態とIDだけを返す
// （金額・氏名は含めない）。契約は docs/payroll.md の「給与明細の代理登録API」。

export async function GET(request: Request, { params }: { params: Promise<{ previewId: string }> }) {
    const { previewId } = await params
    return runSalaryAgent(request.headers.get("authorization"), (owner) => readApprovalForAgent(owner.id, previewId))
}
