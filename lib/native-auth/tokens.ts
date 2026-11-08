import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

/**
 * iOSアプリのログイン引き継ぎ（Issue #1106）で使う、依存の無い暗号まわりの部品。
 * `node --test` から直接読めるよう、DB・Next.js・Supabaseは読み込まない。
 */

/** 値そのものをDBへ置かないためのSHA-256（hex）。 */
export function hashToken(value: string): string {
    return createHash("sha256").update(value).digest("hex")
}

/** URLに載せても安全な、推測できないランダム値（base64url・256bit）。 */
export function randomToken(): string {
    return randomBytes(32).toString("base64url")
}

/** PKCE（RFC 7636）の S256: `BASE64URL(SHA256(verifier))`。 */
export function s256Challenge(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url")
}

const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/
const CHALLENGE_PATTERN = /^[A-Za-z0-9\-_]{43}$/

/** RFC 7636 の code_verifier として許される形か（43〜128文字の非予約文字）。 */
export function isValidVerifier(value: unknown): value is string {
    return typeof value === "string" && VERIFIER_PATTERN.test(value)
}

/** S256の code_challenge（SHA-256のbase64url＝43文字）として許される形か。 */
export function isValidChallenge(value: unknown): value is string {
    return typeof value === "string" && CHALLENGE_PATTERN.test(value)
}

/** 長さが違っても例外にならない、定数時間の文字列比較。 */
export function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a)
    const right = Buffer.from(b)
    if (left.length !== right.length) return false
    return timingSafeEqual(left, right)
}
