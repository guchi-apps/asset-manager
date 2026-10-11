import { getCurrentUserId } from "@/lib/auth"
import { readPayslipPdf } from "@/lib/payroll/payslip-pdf-server"

// 給与明細PDFを読み取り、項目名と金額の行を返す（明細ラボ#256から #714 で移管）。PDFは保存しない。
// 割り当て（どの入力欄へ入れるか）は利用者の項目・記憶に依存するため、クライアント側で行う。
// 読み取りだけで明細には一切書き込まないので、失敗しても既存の明細は変わらない。

const MAX_BYTES = 2 * 1024 * 1024

// pdf.js を Node で動かすため
export const runtime = "nodejs"

export async function POST(request: Request) {
    const userId = await getCurrentUserId()
    if (!userId) return Response.json({ error: "ログインが必要です" }, { status: 401 })

    const form = await request.formData().catch(() => null)
    const file = form?.get("file")
    if (!(file instanceof File)) {
        return Response.json({ error: "PDFファイルを選んでください" }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
        return Response.json({ error: "PDFが大きすぎます（2MBまで）" }, { status: 413 })
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
        return Response.json({ error: "PDFファイルを選んでください" }, { status: 400 })
    }
    const password = form?.get("password")

    const result = await readPayslipPdf(bytes, typeof password === "string" ? password : undefined)
    if (!result.ok) {
        return Response.json({ error: result.error, needsPassword: result.needsPassword }, { status: 422 })
    }
    return Response.json(result.parsed)
}
