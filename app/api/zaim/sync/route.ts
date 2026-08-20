import { NextRequest, NextResponse } from "next/server"
import { findZaimSyncUser, syncZaimValuations } from "@/lib/zaim-sync"

function isAuthorized(request: NextRequest): boolean {
    const configuredSecret = process.env.ZAIM_SYNC_SECRET
    if (!configuredSecret) return false

    const authorization = request.headers.get("authorization")
    return authorization === `Bearer ${configuredSecret}`
}

export async function POST(request: NextRequest) {
    if (!isAuthorized(request)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const configuredEmail = process.env.ZAIM_SYNC_USER_EMAIL
    if (!configuredEmail) {
        return NextResponse.json(
            { error: "ZAIM_SYNC_USER_EMAIL is not configured" },
            { status: 500 }
        )
    }

    // ZAIM_SYNC_USER_EMAIL は「,」区切りで複数指定できる。
    const user = await findZaimSyncUser()

    if (!user) {
        return NextResponse.json({ error: "Sync user not found" }, { status: 404 })
    }

    // 対応付けの初期設定用に、DBへ書き込まず取得結果だけを確認できるようにする。
    const dryRun = request.nextUrl.searchParams.get("dryRun") === "1"

    try {
        const result = await syncZaimValuations(user.id, { dryRun })
        return NextResponse.json({ success: true, ...result })
    } catch (error) {
        console.error("Zaim automatic sync failed:", error)
        return NextResponse.json({ error: "Zaim sync failed" }, { status: 502 })
    }
}
