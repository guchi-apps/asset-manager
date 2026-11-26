import { NextRequest, NextResponse } from "next/server"

import { Prisma } from "@prisma/client"

import { isAutomationAuthorizedShared } from "@/lib/automation-auth"
import { isIsoDate, parseConfirmWithdrawalInput } from "@/lib/ledger-card-withdrawal-confirm"
import { WITHDRAWAL_HORIZON_DAYS } from "@/lib/ledger-card-withdrawal"
import {
    confirmCardWithdrawal,
    deleteCardWithdrawalConfirmation,
    loadCardWithdrawalReport,
} from "@/lib/ledger-card-withdrawal-service"
import { findZaimSyncUser } from "@/lib/zaim-sync"

/**
 * AIDEからカードの引き落とし予定を読み、カード会社のメールの確定額で見込みを上書きする口（Issue #1446）。
 *
 * 画面の案内（`getCardWithdrawals`）はキャッシュしていないため、書き込んだ後の再検証は要らない。
 *
 * 認証・対象ユーザーは `/api/subscriptions` と同じ（`ZAIM_SYNC_SECRET` のBearer・`ZAIM_SYNC_USER_EMAIL`）。
 *
 * - `GET` … 今後 `days` 日（既定30・最大62）の引き落とし予定。各予定に見込み額（`estimatedAmountJpy`）と、
 *   確定額があればその内容（`confirmation`）を付ける。メールの額との食い違いの検出に使う。
 *   引き落としの振替が家計簿に入ったものは `paidAmountJpy` に済み額が入り、`amountJpy` は残りの額になる（#1653）
 * - `POST` … 確定額の登録。本文 `{ cardId | cardName, paymentDate, amount, sourceKey, note? }`。
 *   `sourceKey`（メールの Message-ID など）が同じなら二重に登録しない（`result: "unchanged"`）。
 *   同じカード・同じ引き落とし日に別のキーで届いたら上書きする（`result: "replaced"`）
 * - `DELETE` … 確定額を取り消して見込みへ戻す。`?id=`・`?sourceKey=`・`?cardId=&paymentDate=` のいずれか
 */

const MAX_HORIZON_DAYS = 62

async function authorize(request: NextRequest) {
    if (!(await isAutomationAuthorizedShared(request.headers.get("authorization")))) {
        return { error: NextResponse.json({ status: "error", reason: "Unauthorized" }, { status: 401 }) }
    }
    const user = await findZaimSyncUser()
    if (!user) return { error: NextResponse.json({ status: "error", reason: "Sync user not found" }, { status: 404 }) }
    return { userId: user.id }
}

export async function GET(request: NextRequest) {
    const auth = await authorize(request)
    if ("error" in auth) return auth.error

    const daysParam = request.nextUrl.searchParams.get("days")
    let days = WITHDRAWAL_HORIZON_DAYS
    if (daysParam != null) {
        const parsed = Number(daysParam)
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_HORIZON_DAYS) {
            return NextResponse.json({ status: "error", reason: `days は1〜${MAX_HORIZON_DAYS}の整数で指定してください` }, { status: 400 })
        }
        days = parsed
    }

    try {
        const report = await loadCardWithdrawalReport(auth.userId, days)
        return NextResponse.json({ status: "ok", ...report })
    } catch (error) {
        console.error("[card-withdrawals] GET failed", error)
        return NextResponse.json({ status: "error", reason: "Failed to load card withdrawals" }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    const auth = await authorize(request)
    if ("error" in auth) return auth.error

    let body: unknown
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ status: "error", reason: "本文がJSONとして読めません" }, { status: 400 })
    }
    const parsed = parseConfirmWithdrawalInput(body)
    if (!parsed.ok) return NextResponse.json({ status: "error", reason: parsed.error }, { status: 400 })

    try {
        let result
        try {
            result = await confirmCardWithdrawal(auth.userId, parsed.value)
        } catch (error) {
            // 同じメールが同時に2回届いて一意制約に当たった。もう一度判定すれば unchanged か replace になる
            if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error
            result = await confirmCardWithdrawal(auth.userId, parsed.value)
        }
        if (!result.ok) {
            return NextResponse.json({ status: "error", reason: result.error, existing: result.existing ?? null }, { status: result.status })
        }
        return NextResponse.json({ status: "ok", result: result.result, confirmation: result.confirmation, previousAmountJpy: result.previousAmountJpy })
    } catch (error) {
        console.error("[card-withdrawals] POST failed", error)
        return NextResponse.json({ status: "error", reason: "Failed to save the confirmed amount" }, { status: 500 })
    }
}

export async function DELETE(request: NextRequest) {
    const auth = await authorize(request)
    if ("error" in auth) return auth.error

    const params = request.nextUrl.searchParams
    const id = params.get("id")
    const sourceKey = params.get("sourceKey")
    const cardId = params.get("cardId")
    const paymentDate = params.get("paymentDate")

    let target: Parameters<typeof deleteCardWithdrawalConfirmation>[1]
    if (id != null) {
        if (!/^\d+$/.test(id)) return NextResponse.json({ status: "error", reason: "id は正の整数で指定してください" }, { status: 400 })
        target = { id: Number(id) }
    } else if (sourceKey != null && sourceKey.trim() !== "") {
        target = { sourceKey: sourceKey.trim() }
    } else if (cardId != null && paymentDate != null) {
        if (!/^\d+$/.test(cardId) || !isIsoDate(paymentDate)) {
            return NextResponse.json({ status: "error", reason: "cardId は正の整数、paymentDate は YYYY-MM-DD で指定してください" }, { status: 400 })
        }
        target = { cardId: Number(cardId), paymentDate }
    } else {
        return NextResponse.json({ status: "error", reason: "id・sourceKey・cardId と paymentDate の組のいずれかを指定してください" }, { status: 400 })
    }

    try {
        const deleted = await deleteCardWithdrawalConfirmation(auth.userId, target)
        return NextResponse.json({ status: "ok", deleted })
    } catch (error) {
        console.error("[card-withdrawals] DELETE failed", error)
        return NextResponse.json({ status: "error", reason: "Failed to delete the confirmed amount" }, { status: 500 })
    }
}
