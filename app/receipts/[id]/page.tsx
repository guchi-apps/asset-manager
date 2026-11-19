import { notFound } from "next/navigation"
import { getReceiptDetailAction } from "@/app/actions/receipts"
import { ReceiptEditorHost } from "@/components/receipts/receipt-editor-host"
import { ReceiptAnalyzingView } from "@/components/receipts/receipt-batch-nav"

export const dynamic = "force-dynamic"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const receiptId = Number(id)
    if (!Number.isInteger(receiptId)) notFound()

    const result = await getReceiptDetailAction(receiptId)
    if (!result.success) notFound()

    // 解析中は、終わるまで画像と進み具合だけを出す（Issue #1517。解析はアップロードの応答後に続く）
    if (result.data.status === "ANALYZING") {
        return <ReceiptAnalyzingView receiptId={result.data.id} hasImage={result.data.hasImage} stalled={result.data.analysisStalled} />
    }

    // 再取得・保存で商品行が入れ替わったときの作り直し（#663）と、家計簿登録の途中経過の引き継ぎ（#1521）はホスト側で行う
    return <ReceiptEditorHost detail={result.data} />
}
