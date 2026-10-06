import type { User } from "@supabase/supabase-js"
import { cookies } from "next/headers"

import { resolveAccountLink, type AccountLinkResult } from "@/lib/account-link"
import { createPrismaAccountLinkStore } from "@/lib/account-link-store"
import { seedDummyData } from "@/lib/db/seed"
import { signOutLocal, type SignOutClient } from "@/lib/sign-out"

function metadataString(user: User, key: string): string | null {
    const value = user.user_metadata?.[key]
    return typeof value === "string" ? value : null
}

export function displayName(user: User): string | null {
    return metadataString(user, "full_name") ?? metadataString(user, "name")
}

/**
 * ログイン済みのSupabaseユーザーをUserへ対応付ける（コールバックと/auth/account-linkの共通処理）。
 * ログには段階と結果だけを出し、メール・ID・トークンは出さない。
 */
export async function linkAuthenticatedUser(user: User): Promise<AccountLinkResult> {
    // name・imageは新規作成時の表示用の初期値にだけ使う（本人確認の根拠にはしない）
    const store = createPrismaAccountLinkStore({
        name: displayName(user),
        image: metadataString(user, "avatar_url"),
    })
    const result = await resolveAccountLink(store, user)
    if (result.kind === "created") {
        await seedDummyData(result.userId)
    } else if (result.kind === "relinked") {
        console.info(
            `[auth] 既存のUserを現在のSupabaseユーザーへ紐付けました（以前のID: ${result.replacedPreviousId ? "あり" : "なし"}）`
        )
    } else if (result.kind === "rejected") {
        console.warn(`[auth] 既存のUserへ紐付けませんでした: reason=${result.reason}`)
    }
    return result
}

/**
 * このアプリのセッションだけを破棄する（他アプリのセッションは残す。lib/sign-out.ts）。
 * Supabaseへ通信できずsignOutが失敗しても、Cookieは必ず消して/loginからやり直せるようにする。
 */
export async function endLocalSession(supabase: SignOutClient): Promise<void> {
    try {
        await signOutLocal(supabase)
    } catch (error) {
        console.warn("[auth] signOut(local)に失敗しました。Cookieだけ削除します", error instanceof Error ? error.name : "")
    }
    const cookieStore = await cookies()
    for (const cookie of cookieStore.getAll()) {
        if (cookie.name.startsWith("sb-")) cookieStore.delete(cookie.name)
    }
}
