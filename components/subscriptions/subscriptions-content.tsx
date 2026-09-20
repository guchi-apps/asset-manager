"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SubscriptionList } from "@/components/subscriptions/subscription-list"
import { SubscriptionFormDialog } from "@/components/subscriptions/subscription-form-dialog"
import { SubscriptionDetailDialog } from "@/components/subscriptions/subscription-detail-dialog"
import { MasterSettings } from "@/components/subscriptions/master-settings"
import type { SubscriptionsPageData } from "@/app/actions/subscriptions"
import type { SubscriptionView } from "@/lib/subscription-service"

/**
 * サブスク画面の本体（Issue #491）。
 *
 * サーバーアクションが `revalidatePath("/subscriptions")` するので、更新後は
 * `router.refresh()` で新しい props を受け取り直すだけでよい（手元でのキャッシュは持たない）。
 */
export function SubscriptionsContent({ data }: { data: SubscriptionsPageData }) {
    const router = useRouter()
    const [formTarget, setFormTarget] = React.useState<SubscriptionView | null>(null)
    const [isFormOpen, setIsFormOpen] = React.useState(false)
    const [detailId, setDetailId] = React.useState<number | null>(null)

    const refresh = React.useCallback(() => router.refresh(), [router])

    // 更新後も同じサブスクの詳細を出し続けたいので、idから引き直す
    const detailTarget =
        data.subscriptions.find((subscription) => subscription.id === detailId) ?? null

    const openCreate = () => {
        setFormTarget(null)
        setIsFormOpen(true)
    }

    const openEdit = (subscription: SubscriptionView) => {
        setDetailId(null)
        setFormTarget(subscription)
        setIsFormOpen(true)
    }

    return (
        <Tabs defaultValue="subscriptions" className="flex flex-col gap-4 pt-4">
            <TabsList>
                <TabsTrigger value="subscriptions">サブスク</TabsTrigger>
                <TabsTrigger value="masters">支払い方法・ラベル</TabsTrigger>
            </TabsList>

            <TabsContent value="subscriptions">
                <SubscriptionList
                    subscriptions={data.subscriptions}
                    summary={data.summary}
                    onOpenDetail={(subscription) => setDetailId(subscription.id)}
                    onCreate={openCreate}
                    onEdit={openEdit}
                    onChanged={refresh}
                />
            </TabsContent>

            <TabsContent value="masters">
                <MasterSettings
                    paymentMethods={data.paymentMethods}
                    labels={data.labels}
                    onChanged={refresh}
                />
            </TabsContent>

            {/* どちらのダイアログも、開いている間だけマウントして入力の初期化を任せる */}
            {isFormOpen && (
                <SubscriptionFormDialog
                    open
                    onOpenChange={setIsFormOpen}
                    subscription={formTarget}
                    paymentMethods={data.paymentMethods}
                    labels={data.labels}
                    today={data.today}
                    onSaved={refresh}
                />
            )}

            {detailTarget && (
                <SubscriptionDetailDialog
                    open
                    onOpenChange={(open) => !open && setDetailId(null)}
                    subscription={detailTarget}
                    today={data.today}
                    usdJpyRate={data.summary.usdJpyRate}
                    onEdit={() => openEdit(detailTarget)}
                    onChanged={refresh}
                />
            )}
        </Tabs>
    )
}
