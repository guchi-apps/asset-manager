import { NextRequest, NextResponse } from "next/server"
import { findZaimSyncUser } from "@/lib/zaim-sync"
import { importPayment, validatePaymentImportInput } from "@/lib/payment-import"

function isAuthorized(request: NextRequest): boolean {
    const secret = process.env.ZAIM_SYNC_SECRET
    return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`)
}

export async function POST(request: NextRequest) {
    if (!isAuthorized(request)) return NextResponse.json({ status: "error", reason: "Unauthorized" }, { status: 401 })
    const user = await findZaimSyncUser()
    if (!user) return NextResponse.json({ status: "error", reason: "Import user not found" }, { status: 404 })

    try {
        const input = validatePaymentImportInput(await request.json())
        return NextResponse.json(await importPayment(user.id, input))
    } catch (error) {
        console.error("Payment import failed:", error)
        return NextResponse.json({ status: "error", reason: error instanceof Error ? error.message : "取り込みに失敗しました" }, { status: 400 })
    }
}
