import { NextRequest, NextResponse } from "next/server"

import { parseSubscriptionPriceApiInput } from "@/lib/subscription-api-input"
import { addPrice } from "@/lib/subscription-service"
import { findZaimSyncUser } from "@/lib/zaim-sync"
import { isAutomationAuthorized } from "@/lib/automation-auth"

function isAuthorized(request: NextRequest): boolean {
    return isAutomationAuthorized(request.headers.get("authorization"))
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!isAuthorized(request)) {
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

    const parsed = parseSubscriptionPriceApiInput(body)
    if (!parsed.ok) return NextResponse.json({ status: "error", reason: parsed.error }, { status: 400 })

    try {
        const id = await addPrice(user.id, subscriptionId, parsed.value)
        return NextResponse.json({
            status: "created",
            subscriptionId,
            priceId: id,
            price: { id, ...parsed.value },
        }, { status: 201 })
    } catch (error) {
        console.error("料金履歴の追加に失敗しました", error)
        return NextResponse.json({
            status: "error",
            reason: error instanceof Error ? error.message : "料金履歴を追加できませんでした",
        }, { status: 400 })
    }
}
