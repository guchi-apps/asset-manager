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
import type { SubscriptionPrefill } from "@/lib/subscription-prefill"

/**
 * サブスク画面の本体（Issue #491）。
 *
 * サーバーアクションが `revalidatePath("/subscriptions")` するので、更新後は
 * `router.refresh()` で新しい props を受け取り直すだけでよい（手元でのキャッシュは持たない）。
 */
export function SubscriptionsContent({
    data,
    prefill = null,
}: {
    data: SubscriptionsPageData
    /** クエリ（`?new=1&…`）から読んだ登録フォームの初期値。あれば最初から登録フォームを開く */
    prefill?: SubscriptionPrefill | null
}) {
    const router = useRouter()
    const [formTarget, setFormTarget] = React.useState<SubscriptionView | null>(null)
    const [isFormOpen, setIsFormOpen] = React.useState(prefill !== null)
    // 一度閉じたあと（保存後の refresh を含む）に、同じ初期値で開き直さない
    const [activePrefill, setActivePrefill] = React.useState(prefill)
    const [detailId, setDetailId] = React.useState<number | null>(null)

    const refresh = React.useCallback(() => router.refresh(), [router])

    // 更新後も同じサブスクの詳細を出し続けたいので、idから引き直す
    const detailTarget =
        data.subscriptions.find((subscription) => subscription.id === detailId) ?? null

    const openCreate = () => {
        setActivePrefill(null)
        setFormTarget(null)
        setIsFormOpen(true)
    }

    const openEdit = (subscription: SubscriptionView) => {
        setDetailId(null)
        setActivePrefill(null)
        setFormTarget(subscription)
        setIsFormOpen(true)
    }

    return (
        <Tabs defaultValue="subscriptions" className="flex flex-col gap-4 pt-4">
            <TabsList>
                <TabsTrigger value="subscriptions">定期払い</TabsTrigger>
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
                    ledgerAccounts={data.ledgerAccounts}
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
                    prefill={formTarget ? null : activePrefill}
                    paymentMethods={data.paymentMethods}
                    labels={data.labels}
                    ledgerCategories={data.ledgerCategories}
                    today={data.today}
                    onSaved={refresh}
                />
            )}

            {detailTarget && (
                <SubscriptionDetailDialog
                    open
                    onOpenChange={(open) => !open && setDetailId(null)}
                    subscription={detailTarget}
                    paymentMethods={data.paymentMethods}
                    today={data.today}
                    usdJpyRate={data.summary.usdJpyRate}
                    onEdit={() => openEdit(detailTarget)}
                    onChanged={refresh}
                />
            )}
        </Tabs>
    )
}
