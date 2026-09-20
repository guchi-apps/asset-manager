import { getSubscriptionsPageData } from "@/app/actions/subscriptions"
import { SubscriptionsContent } from "@/components/subscriptions/subscriptions-content"

export const dynamic = "force-dynamic"

export default async function SubscriptionsPage() {
    const data = await getSubscriptionsPageData()
    return <SubscriptionsContent data={data} />
}
