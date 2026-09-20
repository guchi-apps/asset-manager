import { NextRequest, NextResponse } from "next/server"

import { findZaimSyncUser } from "@/lib/zaim-sync"
import { listSubscriptions } from "@/lib/subscription-service"
import {
    CONTRACT_STATUS_LABEL,
    formatBillingDay,
    getMonthlyAmount,
} from "@/lib/subscription-billing"

/**
 * AIDEからサブスクの内容を読むための口（Issue #491）。
 *
 * 認証は `/api/zaim/sync`・`/api/receipts/import` と同じ `ZAIM_SYNC_SECRET` のBearer。
 * 対象ユーザーも同じ `ZAIM_SYNC_USER_EMAIL` で決まるため、AIDE側は追加の設定を持たなくてよい。
 *
 * 金額は「1回あたりの請求額」と「月あたりの金額」の両方を返す。月あたりだけだと
 * 3ヶ月ごと・毎年払いのサブスクの請求額が分からず、請求額だけだと合計が出せない。
 */

function isAuthorized(request: NextRequest): boolean {
    const secret = process.env.ZAIM_SYNC_SECRET
    return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`)
}

export async function GET(request: NextRequest) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ status: "error", reason: "Unauthorized" }, { status: 401 })
    }

    const user = await findZaimSyncUser()
    if (!user) {
        return NextResponse.json({ status: "error", reason: "Sync user not found" }, { status: 404 })
    }

    // 既定では解約済みを返さない。過去の契約まで要るときだけ `?includeEnded=1` を付ける。
    const includeEnded = request.nextUrl.searchParams.get("includeEnded") === "1"

    try {
        const { subscriptions, summary, today } = await listSubscriptions(user.id)
        const visible = includeEnded
            ? subscriptions
            : subscriptions.filter((subscription) => subscription.status !== "ENDED")

        return NextResponse.json({
            status: "ok",
            asOf: today,
            summary: {
                monthlyTotalJpy: Math.round(summary.monthlyTotalJpy),
                yearlyTotalJpy: Math.round(summary.yearlyTotalJpy),
                activeCount: summary.activeCount,
                scheduledToEndCount: summary.scheduledToEndCount,
                endedCount: summary.endedCount,
                usdJpyRate: summary.usdJpyRate,
                /** 円換算できず合計に含めていないサブスク。空なら合計は全件ぶん。 */
                excludedFromTotal: summary.unconvertedNames,
                nextBilling: summary.nextBilling,
            },
            subscriptions: visible.map((subscription) => ({
                id: subscription.id,
                name: subscription.name,
                status: subscription.status,
                statusLabel: CONTRACT_STATUS_LABEL[subscription.status],
                paymentMethod: subscription.paymentMethodName,
                labels: subscription.labels.map((label) => label.name),
                amount: subscription.currentPrice.amount,
                currency: subscription.currentPrice.currency,
                billing: formatBillingDay(subscription.currentPrice),
                billingCycle: subscription.currentPrice.billingCycle,
                billingInterval: subscription.currentPrice.billingInterval,
                billingDay: subscription.currentPrice.billingDay,
                billingMonth: subscription.currentPrice.billingMonth,
                monthlyAmount: Math.round(getMonthlyAmount(subscription.currentPrice) * 100) / 100,
                monthlyAmountJpy:
                    subscription.monthlyAmountJpy === null
                        ? null
                        : Math.round(subscription.monthlyAmountJpy),
                nextBillingDay: subscription.nextBillingDay,
                daysUntilNextBilling: subscription.daysUntilNextBilling,
                startDate: subscription.startDate,
                endDate: subscription.endDate,
                autoRenew: subscription.autoRenew,
                memo: subscription.memo,
            })),
        })
    } catch (error) {
        console.error("サブスクの読み出しに失敗しました", error)
        return NextResponse.json({ status: "error", reason: "Failed to read subscriptions" }, { status: 500 })
    }
}
