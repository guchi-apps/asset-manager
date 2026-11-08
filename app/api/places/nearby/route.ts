import { NextRequest, NextResponse } from "next/server"
import { getCurrentUserId } from "@/lib/auth"
import { NearbyPlacesUnavailableError, fetchNearbyPlaces, parseCoordinates } from "@/lib/nearby-places"

// 外部の共有サービス（Photon・予備のOverpass）へ流すため、ユーザーごとに連続呼び出しを抑える（座標は保存しない）
const MIN_INTERVAL_MS = 2000
const lastCalledAt = new Map<string, number>()

export async function GET(request: NextRequest) {
    const userId = await getCurrentUserId()
    if (!userId) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 })

    const params = request.nextUrl.searchParams
    const center = parseCoordinates(params.get("lat"), params.get("lon"))
    if (!center) return NextResponse.json({ error: "位置情報が正しくありません" }, { status: 400 })

    const now = Date.now()
    if (now - (lastCalledAt.get(userId) ?? 0) < MIN_INTERVAL_MS) {
        return NextResponse.json({ error: "少し待ってからもう一度お試しください" }, { status: 429 })
    }
    lastCalledAt.set(userId, now)
    if (lastCalledAt.size > 500) {
        for (const [key, at] of lastCalledAt) if (now - at > MIN_INTERVAL_MS) lastCalledAt.delete(key)
    }

    try {
        const places = await fetchNearbyPlaces(center)
        return NextResponse.json({ places })
    } catch (error) {
        if (error instanceof NearbyPlacesUnavailableError) {
            return NextResponse.json({ error: error.message }, { status: 503 })
        }
        return NextResponse.json({ error: "周辺のお店を取得できませんでした" }, { status: 500 })
    }
}
