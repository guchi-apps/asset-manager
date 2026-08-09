import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { syncZaimValuations } from "@/lib/zaim-sync"

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

    const user = await prisma.user.findUnique({
        where: { email: configuredEmail },
        select: { id: true },
    })

    if (!user) {
        return NextResponse.json({ error: "Sync user not found" }, { status: 404 })
    }

    try {
        const result = await syncZaimValuations(user.id)
        return NextResponse.json({ success: true, ...result })
    } catch (error) {
        console.error("Zaim automatic sync failed:", error)
        return NextResponse.json({ error: "Zaim sync failed" }, { status: 502 })
    }
}
