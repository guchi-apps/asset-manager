import { getReceiptOverviewAction } from "@/app/actions/receipts"
import { ReceiptsContent } from "@/components/receipts/receipts-content"

export const dynamic = "force-dynamic"

export default async function Page() {
    const result = await getReceiptOverviewAction()

    return (
        <ReceiptsContent
            initialData={result.success ? result.data : null}
            initialError={result.success ? null : result.error}
        />
    )
}
