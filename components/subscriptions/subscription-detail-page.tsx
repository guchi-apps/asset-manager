"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { SubscriptionDetail } from "@/components/subscriptions/subscription-detail-dialog"
import { SubscriptionFormDialog } from "@/components/subscriptions/subscription-form-dialog"
import type { SubscriptionsPageData } from "@/app/actions/subscriptions"
import type { SubscriptionView } from "@/lib/subscription-service"

/**
 * 定期払いの詳細ページ（Issue #1320）。モーダルをやめて全画面で出す。
 * 編集は同じ編集ダイアログをこのページで開き、保存後は `router.refresh()` で表示を更新する。
 */
export function SubscriptionDetailPage({
    data,
    subscription,
}: {
    data: SubscriptionsPageData
    subscription: SubscriptionView
}) {
    const router = useRouter()
    const [isEditing, setIsEditing] = React.useState(false)
    const refresh = React.useCallback(() => router.refresh(), [router])

    const category = data.ledgerCategories.find((choice) => choice.ledgerCategoryId === subscription.ledgerCategoryId)
    const categoryName = category
        ? category.genreName
            ? `${category.categoryName} › ${category.genreName}`
            : category.categoryName
        : null

    return (
        <>
            <SubscriptionDetail
                subscription={subscription}
                paymentMethods={data.paymentMethods}
                today={data.today}
                usdJpyRate={data.summary.usdJpyRate}
                categoryName={categoryName}
                onEdit={() => setIsEditing(true)}
                onChanged={refresh}
            />
            {isEditing && (
                <SubscriptionFormDialog
                    open
                    onOpenChange={setIsEditing}
                    subscription={subscription}
                    paymentMethods={data.paymentMethods}
                    labels={data.labels}
                    ledgerCategories={data.ledgerCategories}
                    today={data.today}
                    onSaved={refresh}
                />
            )}
        </>
    )
}
