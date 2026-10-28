import { INVALID_JSON, previewSalaryImport, readJsonBody, runSalaryAgent } from "@/lib/payroll/agent-import-server"

// 給与明細の代理登録（Issue #791）: PDFを読み、保存する内容・照合結果・保存を止める理由を返す。DBには書き込まない。
// 契約は docs/payroll.md の「給与明細の代理登録API」。

// pdf.js を Node で動かすため
export const runtime = "nodejs"

export async function POST(request: Request) {
    return runSalaryAgent(request.headers.get("authorization"), async (owner, secret) => {
        const body = await readJsonBody(request)
        return body ? previewSalaryImport(owner.id, secret, body) : INVALID_JSON
    })
}
