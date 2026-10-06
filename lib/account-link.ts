// Supabaseのユーザーとアプリ内のUserを対応付ける（Issue #641）。
//
// Supabaseは他のアプリと共有しており、どこかでSupabaseのユーザーが削除・再作成されると、
// 同じGoogleアカウントでも新しいSupabaseユーザーID（user.id）でログインしてくる。
// 以前のコールバックは「メールでUserを探し、supabaseUserIdが空のときだけ書き込む」実装で、
// 旧IDが残っていると新IDへ紐付かず、ログイン後に資産・取引が1件も見えない状態になっていた。
//
// 再紐付けはUser.idを保ったままsupabaseUserIdだけを付け替え、関連データには触らない。
// 根拠にするのは、Supabaseがプロバイダ（Google）から受け取った本人情報（identities）のうち
// 確認済みのメールだけ。user_metadataは本人がupdateUser()で書き換えられるため使わない。

export const ACCOUNT_LINK_PROVIDER = "google"

/** Supabaseの`User`のうち、判定に使う部分だけ */
export interface AccountLinkAuthUser {
    id: string
    email?: string | null
    email_confirmed_at?: string | null
    identities?: Array<{
        provider: string
        identity_data?: Record<string, unknown> | null
    }> | null
}

export interface AccountLinkUserRow {
    id: string
    email: string | null
    supabaseUserId: string | null
}

export interface AccountLinkStore {
    findBySupabaseUserId(supabaseUserId: string): Promise<AccountLinkUserRow | null>
    findByEmail(email: string): Promise<AccountLinkUserRow | null>
    /**
     * `supabaseUserId`が`expected`のままのときだけ`next`へ付け替え、付け替えたかを返す。
     * 判定と更新のあいだに別のリクエストが書き換えた場合はfalse（上書きしない）。
     */
    relink(userId: string, expected: string | null, next: string): Promise<boolean>
    create(input: { email: string; supabaseUserId: string }): Promise<AccountLinkUserRow>
}

export type AccountLinkResult =
    | { kind: "linked"; userId: string }
    | { kind: "relinked"; userId: string; replacedPreviousId: boolean }
    | { kind: "created"; userId: string }
    | { kind: "rejected"; reason: AccountLinkRejectReason }

export type AccountLinkRejectReason =
    /** Supabaseのユーザーにメールが無い */
    | "missing_email"
    /** 既存Userのメールと一致するが、プロバイダが確認したメールではない */
    | "unverified"
    /** 同時に別の紐付けが進んでいて、何度読み直しても確定できない */
    | "conflict"

const MAX_ATTEMPTS = 3

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase()
}

/**
 * プロバイダ（Google）が確認済みとして返したメール。確認できなければnull。
 *
 * `identities[].identity_data`はSupabaseがOAuthの応答から保存する値で、
 * クライアントから書き換えられない（書き換えられる`user_metadata`とは別物）。
 * Supabase側のメール確認（`email_confirmed_at`）と、プロバイダ側の`email_verified`の両方を要求する。
 */
export function verifiedProviderEmail(user: AccountLinkAuthUser): string | null {
    if (!user.email || !user.email_confirmed_at) return null
    const email = normalizeEmail(user.email)
    const identity = (user.identities ?? []).find((candidate) => {
        if (candidate.provider !== ACCOUNT_LINK_PROVIDER) return false
        const data = candidate.identity_data ?? {}
        return (
            data.email_verified === true &&
            typeof data.email === "string" &&
            normalizeEmail(data.email) === email
        )
    })
    return identity ? email : null
}

/** Prismaの一意制約違反（P2002）。同時に作成・付け替えが走ったときに起きる */
export function isUniqueConstraintError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2002"
    )
}

/**
 * ログインしたSupabaseユーザーに対応するUserを決める。必要なら作成・再紐付けする。
 *
 * - supabaseUserIdで見つかれば、そのUser（通常のログイン）
 * - 見つからず、同じメールのUserがあれば、確認済みメールのときだけ付け替える（User.idは保持）
 * - どちらも無ければ新規作成
 *
 * DBへの書き込みに失敗した場合（一意制約違反以外）は例外をそのまま投げる。
 */
export async function resolveAccountLink(
    store: AccountLinkStore,
    authUser: AccountLinkAuthUser
): Promise<AccountLinkResult> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const linked = await store.findBySupabaseUserId(authUser.id)
        if (linked) return { kind: "linked", userId: linked.id }

        if (!authUser.email) return { kind: "rejected", reason: "missing_email" }

        const byEmail = await store.findByEmail(authUser.email)
        if (!byEmail) {
            try {
                const created = await store.create({ email: authUser.email, supabaseUserId: authUser.id })
                return { kind: "created", userId: created.id }
            } catch (error) {
                // 同じメール・同じIDのUserを別のリクエストが先に作った。読み直して判定し直す
                if (isUniqueConstraintError(error)) continue
                throw error
            }
        }

        const verified = verifiedProviderEmail(authUser)
        if (!verified || !byEmail.email || normalizeEmail(byEmail.email) !== verified) {
            return { kind: "rejected", reason: "unverified" }
        }

        const previous = byEmail.supabaseUserId
        try {
            const updated = await store.relink(byEmail.id, previous, authUser.id)
            if (updated) {
                return { kind: "relinked", userId: byEmail.id, replacedPreviousId: previous !== null }
            }
        } catch (error) {
            if (!isUniqueConstraintError(error)) throw error
        }
        // 付け替えのあいだに別のリクエストが書き換えた。読み直して判定し直す
    }
    return { kind: "rejected", reason: "conflict" }
}
