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

    return <ReceiptEditor detail={result.data} />
}
