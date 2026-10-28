import { readSalaryForAgent, runSalaryAgent } from "@/lib/payroll/agent-import-server"

// 給与明細の代理登録（Issue #791）: 登録後に実レコードを照合する読み取り専用の口。所有者の明細だけを返す。

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    return runSalaryAgent(request.headers.get("authorization"), (owner) => readSalaryForAgent(owner.id, id))
}
