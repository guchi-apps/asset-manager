import { hashToken, randomToken, s256Challenge, safeEqual } from "./tokens"

/**
 * ログインの引き継ぎ（Issue #1106。Morrow #441 と同じ方式）。
 *
 * ASWebAuthenticationSession（エフェメラル）で確立したSupabaseセッションを、WKWebView へ
 * 「一度限りのコード」だけで渡す。アプリへ返すのはコードだけで、トークンは custom scheme の
 * URL・ログ・アプリのコードのどこにも出ない。
 *
 * - 発行: 認証シート側の `/auth/callback`。トークンは暗号化済みの文字列で受け取る
 * - 消費: WKWebView側の `/auth/native/consume`。コードと、アプリだけが持つ `code_verifier` が要る
 *   （コードだけを横取りしたアプリは、verifierが無ければ消費できない）
 *
 * DBアクセスは `HandoffStore` で注入する（実体は `store.ts`）。
 */

/** コードの有効期間。認証シートを閉じてアプリが消費するまでの間だけあればよい。 */
export const HANDOFF_TTL_MS = 60_000

/** 用途。別フローのコードをここで消費させないための印。 */
export const HANDOFF_PURPOSE_LOGIN = "login"

export type HandoffPurpose = typeof HANDOFF_PURPOSE_LOGIN

export type HandoffRecord = {
    codeHash: string
    purpose: HandoffPurpose
    challengeHash: string
    sessionCipher: string
    next: string | null
    expiresAt: Date
}

export type HandoffStore = {
    create(record: HandoffRecord): Promise<void>
    /**
     * 未使用・期限内・用途一致の行を **原子的に** 使用済みにして返す。該当が無ければ null。
     * 同時に2回呼ばれても、片方しか行を受け取れない。
     */
    claim(
        codeHash: string,
        purpose: HandoffPurpose,
        now: Date
    ): Promise<Pick<HandoffRecord, "challengeHash" | "sessionCipher" | "next"> | null>
}

export async function issueHandoff(input: {
    store: HandoffStore
    /** アプリが送ってきた code_challenge（S256）。 */
    challenge: string
    sessionCipher: string
    next: string | null
    now: Date
}): Promise<string> {
    const code = randomToken()
    await input.store.create({
        codeHash: hashToken(code),
        purpose: HANDOFF_PURPOSE_LOGIN,
        challengeHash: hashToken(input.challenge),
        sessionCipher: input.sessionCipher,
        next: input.next,
        expiresAt: new Date(input.now.getTime() + HANDOFF_TTL_MS),
    })
    return code
}

export type ConsumedHandoff = { sessionCipher: string; next: string | null }

/**
 * コードを消費する。失敗の理由（使用済み・期限切れ・別用途・verifier不一致）は呼び出し元へ
 * 区別して返さない（推測の手掛かりを与えない）。
 *
 * verifierの検証より先に行を使用済みにする。不一致でもコードは燃え、総当たりの余地が残らない。
 */
export async function consumeHandoff(input: {
    store: HandoffStore
    code: string
    verifier: string
    now: Date
}): Promise<ConsumedHandoff | null> {
    const row = await input.store.claim(hashToken(input.code), HANDOFF_PURPOSE_LOGIN, input.now)
    if (!row) return null

    if (!safeEqual(row.challengeHash, hashToken(s256Challenge(input.verifier)))) return null

    return { sessionCipher: row.sessionCipher, next: row.next }
}
