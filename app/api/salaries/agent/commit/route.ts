import { INVALID_JSON, commitSalaryImport, readJsonBody, runSalaryAgent } from "@/lib/payroll/agent-import-server"

// 給与明細の代理登録（Issue #791）: 本人が承認したプレビューと同じ内容なら給与を登録する。
// 同じメール・同じ支給日の明細があれば登録も上書きもせず、既存の明細のIDを返す。
// 契約は docs/payroll.md の「給与明細の代理登録API」。

// pdf.js を Node で動かすため
export const runtime = "nodejs"

export async function POST(request: Request) {
    return runSalaryAgent(request.headers.get("authorization"), async (owner, secret) => {
        const body = await readJsonBody(request)
        return body ? commitSalaryImport(owner.id, secret, body) : INVALID_JSON
    })
}
