import { NextRequest, NextResponse } from "next/server"

import { getAiUsageResponse } from "@/lib/ai-usage-log"
import { isOpsApiAuthorized } from "@/lib/ops-api-auth"

/**
 * ops-dashboard の「アプリ別のAI利用」が読む、AIの使用量の口（Issue #535）。
 *
 * 機能×モデルごとに、直近24時間・7日間の呼び出し回数とトークン数を返す。
 * 応答の形の正は ops-dashboard の README「アプリ別のAI利用」。1行でも形が違うと、
 * ops-dashboard は応答全体を採用せず「取得不可」と出す。
 *
 * 認証は `Authorization: Bearer <OPS_API_TOKEN>`（ops-dashboard と同じ値）。
 * 呼び出しが無い期間は `{ "features": [] }` を返す（エラーにしない）。
 * 返すのは回数とトークン数だけで、プロンプト本文・ユーザー入力・トークンは含めない。
 */
export async function GET(request: NextRequest) {
    if (!isOpsApiAuthorized(request.headers.get("authorization"))) {
        return NextResponse.json({ status: "error", reason: "Unauthorized" }, { status: 401 })
    }

    try {
        const usage = await getAiUsageResponse()
        return NextResponse.json(usage, { headers: { "Cache-Control": "no-store" } })
    } catch (error) {
        console.error("AI usage aggregation failed:", error)
        return NextResponse.json({ status: "error", reason: "Aggregation failed" }, { status: 500 })
    }
}
