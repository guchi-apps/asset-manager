import { getRebalanceData } from "@/app/actions/rebalance"
import { RebalanceContent } from "@/components/rebalance/rebalance-content"

export const dynamic = "force-dynamic"

export default async function Page() {
    const data = await getRebalanceData()

    return <RebalanceContent initialData={data} />
}
