import { NextRequest, NextResponse } from "next/server"

import { findZaimSyncUser } from "@/lib/zaim-sync"
import { isAutomationAuthorizedShared } from "@/lib/automation-auth"
import { createSubscription, listSubscriptions, resolveActivePaymentMethodId } from "@/lib/subscription-service"
import { parseSubscriptionCreateApiInput } from "@/lib/subscription-api-input"
import { SUBSCRIPTION_CATEGORY_LABEL } from "@/lib/subscription-category"
import {
    getContractStatusLabel,
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
 *
 * 契約には区分（`category`）がある（Issue #512）。`summary.monthlyTotalJpy` などの
 * 「サブスク合計」は SUBSCRIPTION だけの集計で、保険・税金・分割払いを含む全体は
 * `summary.fixedCost*`、区分ごとの内訳は `summary.byCategory` にある。
 */

async function isAuthorized(request: NextRequest): Promise<boolean> {
    return isAutomationAuthorizedShared(request.headers.get("authorization"))
}

export async function GET(request: NextRequest) {
    if (!(await isAuthorized(request))) {
        return NextResponse.json({ status: "error", reason: "Unauthorized" }, { status: 401 })
    }

    const user = await findZaimSyncUser()
    if (!user) {
        return NextResponse.json({ status: "error", reason: "Sync user not found" }, { status: 404 })
    }

    // 既定では解約済みを返さない。過去の契約まで要るときだけ `?includeEnded=1` を付ける。
    const includeEnded = request.nextUrl.searchParams.get("includeEnded") === "1"
    // 解約予定なのに終了日が未入力の契約だけを返す（確認・通知の対象を拾う用。Issue #513）
    const onlyNeedsEndDate = request.nextUrl.searchParams.get("needsEndDate") === "1"

    try {
        const { subscriptions, summary, today } = await listSubscriptions(user.id)
        const byAccount = summary.byAccount
        const visible = onlyNeedsEndDate
            ? subscriptions.filter((subscription) => subscription.needsEndDate)
            : includeEnded
              ? subscriptions
              : subscriptions.filter((subscription) => subscription.status !== "ENDED")

        return NextResponse.json({
            status: "ok",
            asOf: today,
            summary: {
                /** 区分が SUBSCRIPTION の契約だけの月あたり合計（円） */
                monthlyTotalJpy: Math.round(summary.monthlyTotalJpy),
                yearlyTotalJpy: Math.round(summary.yearlyTotalJpy),
                activeCount: summary.activeCount,
                scheduledToEndCount: summary.scheduledToEndCount,
                endedCount: summary.endedCount,
                /** 全区分（保険・税金・分割払いを含む）の月額固定費 */
                fixedCostMonthlyTotalJpy: Math.round(summary.fixedCostMonthlyTotalJpy),
                fixedCostYearlyTotalJpy: Math.round(summary.fixedCostYearlyTotalJpy),
                fixedCostActiveCount: summary.fixedCostActiveCount,
                byCategory: summary.byCategory.map((row) => ({
                    category: row.category,
                    categoryLabel: SUBSCRIPTION_CATEGORY_LABEL[row.category],
                    activeCount: row.activeCount,
                    scheduledToEndCount: row.scheduledToEndCount,
                    endedCount: row.endedCount,
                    monthlyTotalJpy: Math.round(row.monthlyTotalJpy),
                })),
                /** 解約予定なのに終了日が未入力の契約。確認して終了日を入れる対象 */
                /**
                 * 引き落とし先の家計簿の口座ごとの件数・月額（全区分・解約済みを除く。Issue #566・#878）。
                 * `status` が NO_ACCOUNT は口座を通らない支払い（給与天引きなど）、UNSET は紐づけ未設定。
                 */
                byLedgerAccount: byAccount.map((row) => ({
                    ...row,
                    monthlyTotalJpy: Math.round(row.monthlyTotalJpy),
                })),
                /** @deprecated `byLedgerAccount` を使う。名前は家計簿の口座名、`zaimAccountId` は常に null（#878） */
                byZaimAccount: byAccount.map((row) => ({
                    status: row.status,
                    zaimAccountId: null,
                    zaimAccountName: row.ledgerAccountName,
                    activeCount: row.activeCount,
                    monthlyTotalJpy: Math.round(row.monthlyTotalJpy),
                    subscriptionNames: row.subscriptionNames,
                })),
                needsEndDateCount: summary.needsEndDateCount,
                needsEndDateNames: summary.needsEndDateNames,
                usdJpyRate: summary.usdJpyRate,
                /** 円換算できず合計に含めていないサブスク。空なら合計は全件ぶん。 */
                excludedFromTotal: summary.unconvertedNames,
                nextBilling: summary.nextBilling,
            },
            subscriptions: visible.map((subscription) => ({
                id: subscription.id,
                name: subscription.name,
                category: subscription.category,
                categoryLabel: SUBSCRIPTION_CATEGORY_LABEL[subscription.category],
                status: subscription.status,
                statusLabel: getContractStatusLabel(subscription.status, subscription.autoRenew),
                paymentMethod: subscription.paymentMethodName,
                /**
                 * いまの支払い方法が最終的に引き落とされる家計簿の口座（Issue #566・#878）。`ledgerAccountId` は
                 * `LedgerAccount.id` で口座名が変わっても同じ。`accountLink` は LINKED / NO_ACCOUNT（給与天引きなど）/ UNSET。
                 */
                accountLink: subscription.accountLink.status,
                ledgerAccountId: subscription.accountLink.ledgerAccountId,
                ledgerAccountName: subscription.accountLink.ledgerAccountName,
                /** @deprecated 旧項目（AIDE移行用）。`accountLink` / `ledgerAccountName` を使う。`zaimAccountId` は常に null（#878） */
                zaimLink: subscription.accountLink.status,
                zaimAccountId: null,
                zaimAccountName: subscription.accountLink.ledgerAccountName,
                labels: subscription.labels.map((label) => label.name),
                /**
                 * いま適用されている料金履歴のメモ（プラン名・変更理由）。ChatGPT・Claude Code の
                 * ように月ごとにプランが変わる契約は、契約本体ではなく料金履歴に残している。
                 */
                currentPlan: subscription.currentPlan,
                currentPlanSince: subscription.currentPrice.effectiveFrom,
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
                /** 更新されない契約（終了日未入力で自動更新もしない解約予定）は null。請求は発生しない */
                nextBillingDay: subscription.nextBillingDay,
                daysUntilNextBilling: subscription.daysUntilNextBilling,
                startDate: subscription.startDate,
                endDate: subscription.endDate,
                autoRenew: subscription.autoRenew,
                /** 解約予定（検討中を含む）。`status` は終了日とこの値から決まり、自動更新かどうかとは別 */
                cancelPlanned: subscription.cancelPlanned,
                /** 分割払いの支払回数と進み具合（残り回数・残額・最終請求日）。分割払いでなければ null */
                installmentCount: subscription.installmentCount,
                installment: subscription.installment,
                /**
                 * 解約予定の終了情報。契約終了日（入力値）・最終請求日・利用期限を区別して返す。
                 * `usableUntilIsEstimate` が true のときの利用期限は、最終請求日と支払い周期からの見込み。
                 * 解約予定でなければ null。
                 */
                endInfo: subscription.endInfo,
                /** 解約予定なのに終了日が未入力。true なら終了日を確認する */
                needsEndDate: subscription.needsEndDate,
                memo: subscription.memo,
                /** 最終更新日時（ISO 8601）。編集 API（`PATCH /api/subscriptions/:id`）の `expectedUpdatedAt` に渡す */
                updatedAt: subscription.updatedAt.toISOString(),
                /** 料金・プランの変更履歴。古い順（時系列）。`planName` がその期間のプラン名、`memo` が変更理由 */
                priceHistory: subscription.prices.map((price) => ({
                    effectiveFrom: price.effectiveFrom,
                    amount: price.amount,
                    currency: price.currency,
                    billing: formatBillingDay(price),
                    planName: price.planName?.trim() || null,
                    memo: price.memo?.trim() || null,
                    isCurrent: price.id === subscription.currentPrice.id,
                })),
                /**
                 * 支払い方法の変更履歴。古い順（時系列）。`memo` が変更理由・根拠（Issue #517）。
                 * `paymentMethod` は現在の支払い方法（`subscription.paymentMethod` と同じ値）と同じ形。
                 */
                paymentMethodHistory: subscription.paymentMethodHistory.map((history) => ({
                    effectiveFrom: history.effectiveFrom,
                    paymentMethod: history.paymentMethodName,
                    accountLink: history.accountLink.status,
                    ledgerAccountId: history.accountLink.ledgerAccountId,
                    ledgerAccountName: history.accountLink.ledgerAccountName,
                    /** @deprecated 旧項目（AIDE移行用）。#878 以降 `zaimAccountId` は常に null */
                    zaimLink: history.accountLink.status,
                    zaimAccountId: null,
                    zaimAccountName: history.accountLink.ledgerAccountName,
                    memo: history.memo,
                    isCurrent: history.id === subscription.currentPaymentMethodHistoryId,
                })),
            })),
        })
    } catch (error) {
        console.error("定期払いの読み出しに失敗しました", error)
        return NextResponse.json({ status: "error", reason: "Failed to read subscriptions" }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    if (!(await isAuthorized(request))) {
        return NextResponse.json({ status: "error", reason: "Unauthorized" }, { status: 401 })
    }

    const user = await findZaimSyncUser()
    if (!user) {
        return NextResponse.json({ status: "error", reason: "Sync user not found" }, { status: 404 })
    }

    let body: unknown
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ status: "error", reason: "入力が正しくありません" }, { status: 400 })
    }

    const parsed = parseSubscriptionCreateApiInput(body)
    if (!parsed.ok) return NextResponse.json({ status: "error", reason: parsed.error }, { status: 400 })

    try {
        const paymentMethodId = await resolveActivePaymentMethodId(
            user.id,
            parsed.value.subscription.paymentMethodName
        )
        if (!paymentMethodId) {
            return NextResponse.json({ status: "error", reason: "有効な支払い方法が見つかりません" }, { status: 400 })
        }

        const { paymentMethodName, ...subscription } = parsed.value.subscription
        const id = await createSubscription(user.id, { ...subscription, paymentMethodId }, parsed.value.price)
        return NextResponse.json({
            status: "created",
            subscriptionId: id,
            subscription: { id, paymentMethodName, ...subscription },
            price: parsed.value.price,
        }, { status: 201 })
    } catch (error) {
        console.error("定期払いの作成に失敗しました", error)
        return NextResponse.json({ status: "error", reason: "定期払いを作成できませんでした" }, { status: 500 })
    }
}
