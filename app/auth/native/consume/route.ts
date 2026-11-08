import { NextResponse, type NextRequest } from "next/server"

import { endLocalSession, linkAuthenticatedUser } from "@/lib/account-link-session"
import { decryptSession } from "@/lib/native-auth/cipher"
import { consumeHandoff } from "@/lib/native-auth/handoff"
import { safeNextPath } from "@/lib/native-auth/native-app"
import { handoffStore } from "@/lib/native-auth/store"
import { isValidVerifier } from "@/lib/native-auth/tokens"
import { createClient } from "@/lib/supabase/server"

/**
 * 引き継ぎコードを消費して、WKWebViewへ通常のSupabase SSR Cookieを渡す（Issue #1106）。
 *
 * WKWebViewの中から `fetch`（同一オリジン・POST）で呼ぶ。コードとcode_verifierはURLではなく
 * 本文で受けるため、アクセスログに残らない。失敗の理由は区別せず同じ応答にする。
 */
export async function POST(request: NextRequest) {
    const rejected = () => NextResponse.json({ error: "invalid_handoff" }, { status: 400 })

    let body: unknown
    try {
        body = await request.json()
    } catch {
        return rejected()
    }
    const fields = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
    const code = typeof fields.code === "string" ? fields.code : ""
    const verifier = fields.verifier

    if (!code || code.length > 128 || !isValidVerifier(verifier)) return rejected()

    const handoff = await consumeHandoff({ store: handoffStore, code, verifier, now: new Date() })
    if (!handoff) return rejected()

    let tokens: { accessToken?: unknown; refreshToken?: unknown }
    try {
        tokens = JSON.parse(decryptSession(handoff.sessionCipher))
    } catch {
        return rejected()
    }
    if (typeof tokens.accessToken !== "string" || typeof tokens.refreshToken !== "string") return rejected()

    const supabase = await createClient()
    const { data, error } = await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
    })
    if (error || !data.user) return rejected()

    // 発行から消費までの間にUserとの対応が変わっていないかを、callbackと同じ処理でもう一度確かめる
    // （対応付けは冪等で、すでに紐付いていれば何も書き換えない）。
    try {
        const result = await linkAuthenticatedUser(data.user)
        if (result.kind === "rejected") {
            await endLocalSession(supabase)
            return NextResponse.json({ error: "not_allowed" }, { status: 403 })
        }
    } catch (linkError) {
        console.error("[auth/native/consume] Userの対応付けに失敗しました", linkError instanceof Error ? linkError.name : "")
        await endLocalSession(supabase)
        return rejected()
    }

    return NextResponse.json({ next: safeNextPath(handoff.next) })
}
