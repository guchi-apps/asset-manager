import { NextRequest, NextResponse } from "next/server"

import { isAutomationAuthorizedShared } from "@/lib/automation-auth"
import { parseSubscriptionPatchApiInput } from "@/lib/subscription-api-input"
import { patchSubscription, SubscriptionPatchError } from "@/lib/subscription-service"
import { findZaimSyncUser } from "@/lib/zaim-sync"

/**
 * AIDEから契約の項目を編集する口（Issue #711）。認証は `/api/subscriptions` と同じ Bearer。
 * 送った項目だけを更新し、料金履歴は触らない。`expectedName`・`expectedUpdatedAt` が
 * 現在と違えば 409 で何も書かない。
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!(await isAutomationAuthorizedShared(request.headers.get("authorization")))) {
        return NextResponse.json({ status: "error", reason: "Unauthorized" }, { status: 401 })
    }

    const user = await findZaimSyncUser()
    if (!user) {
        return NextResponse.json({ status: "error", reason: "Sync user not found" }, { status: 404 })
    }

    const { id: rawId } = await params
    const subscriptionId = Number(rawId)
    if (!Number.isSafeInteger(subscriptionId) || subscriptionId <= 0) {
        return NextResponse.json({ status: "error", reason: "サブスクIDが正しくありません" }, { status: 400 })
    }

    let body: unknown
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ status: "error", reason: "入力が正しくありません" }, { status: 400 })
    }

    const parsed = parseSubscriptionPatchApiInput(body)
    if (!parsed.ok) return NextResponse.json({ status: "error", reason: parsed.error }, { status: 400 })

    try {
        const updated = await patchSubscription(user.id, subscriptionId, parsed.value)
        return NextResponse.json({
            status: "updated",
            subscription: {
                id: updated.id,
                name: updated.name,
                category: updated.category,
                paymentMethod: updated.paymentMethodName,
                startDate: updated.startDate,
                endDate: updated.endDate,
                autoRenew: updated.autoRenew,
                cancelPlanned: updated.cancelPlanned,
                memo: updated.memo,
                labels: updated.labels.map((label) => label.name),
                updatedAt: updated.updatedAt.toISOString(),
            },
        })
    } catch (error) {
        if (error instanceof SubscriptionPatchError) {
            return NextResponse.json({ status: "error", reason: error.message }, { status: error.status })
        }
        console.error("サブスクの更新に失敗しました", error)
        return NextResponse.json({ status: "error", reason: "サブスクを更新できませんでした" }, { status: 500 })
    }
}
