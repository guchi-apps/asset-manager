import { notFound } from "next/navigation"

import { getSubscriptionsPageData } from "@/app/actions/subscriptions"
import { SubscriptionDetailPage } from "@/components/subscriptions/subscription-detail-page"

export const dynamic = "force-dynamic"

/** 定期払いの詳細（全画面。Issue #1320） */
export default async function SubscriptionDetailRoute({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const subscriptionId = Number(id)
    if (!Number.isInteger(subscriptionId)) notFound()

    const data = await getSubscriptionsPageData()
    const subscription = data.subscriptions.find((row) => row.id === subscriptionId)
    if (!subscription) notFound()

    return <SubscriptionDetailPage data={data} subscription={subscription} />
}
