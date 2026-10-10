import { notFound } from "next/navigation"
import { getReceiptDetailAction } from "@/app/actions/receipts"
import { ReceiptEditor } from "@/components/receipts/receipt-editor"

export const dynamic = "force-dynamic"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const receiptId = Number(id)
    if (!Number.isInteger(receiptId)) notFound()

    const result = await getReceiptDetailAction(receiptId)
    if (!result.success) notFound()

    // 再取得で商品行が入れ替わったとき、編集中の状態を作り直す（#663）
    return <ReceiptEditor key={result.data.items.map((item) => item.id).join("-")} detail={result.data} />
}
