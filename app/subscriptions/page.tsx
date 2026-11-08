import { getSubscriptionsPageData } from "@/app/actions/subscriptions"
import { SubscriptionsContent } from "@/components/subscriptions/subscriptions-content"
import { parseSubscriptionPrefill } from "@/lib/subscription-prefill"

export const dynamic = "force-dynamic"

export default async function SubscriptionsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
    const [data, params] = await Promise.all([getSubscriptionsPageData(), searchParams])
    // Morrowのメール提案からのクエリ（Issue #1203）。new=1 のときだけ登録フォームを開く
    const prefill = parseSubscriptionPrefill(params)
    return <SubscriptionsContent data={data} prefill={prefill} />
}
