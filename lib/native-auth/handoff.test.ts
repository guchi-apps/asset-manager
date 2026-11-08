import { test } from "node:test"
import assert from "node:assert/strict"

import { decryptSession, encryptSession } from "./cipher"
import { consumeHandoff, HANDOFF_TTL_MS, issueHandoff, type HandoffRecord, type HandoffStore } from "./handoff"
import { encodeNativeLoginState, nativeLoginCodeUrl, parseNativeLoginState, safeNextPath } from "./native-app"
import { isValidChallenge, isValidVerifier, s256Challenge } from "./tokens"

/** HandoffStore の約束（未使用・期限内・用途一致の行だけを原子的に確保する）をメモリ上で守る実装 */
function memoryStore(): HandoffStore & { rows: (HandoffRecord & { usedAt: Date | null })[] } {
    const rows: (HandoffRecord & { usedAt: Date | null })[] = []
    return {
        rows,
        async create(record) {
            rows.push({ ...record, usedAt: null })
        },
        async claim(codeHash, purpose, now) {
            const row = rows.find(
                (r) => r.codeHash === codeHash && r.purpose === purpose && r.usedAt === null && r.expiresAt > now
            )
            if (!row) return null
            row.usedAt = now
            return { challengeHash: row.challengeHash, sessionCipher: row.sessionCipher, next: row.next }
        },
    }
}

const VERIFIER = "v".repeat(43) + "-._~0123456789"
const CHALLENGE = s256Challenge(VERIFIER)
const NOW = new Date("2026-11-07T03:00:00Z")

test("PKCEのverifierとchallengeの形を検証する", () => {
    assert.equal(isValidVerifier(VERIFIER), true)
    assert.equal(isValidVerifier("short"), false)
    assert.equal(isValidVerifier("あ".repeat(50)), false)
    assert.equal(isValidChallenge(CHALLENGE), true)
    assert.equal(isValidChallenge(CHALLENGE + "x"), false)
    assert.equal(isValidChallenge(null), false)
})

test("発行したコードは、対応するverifierで一度だけ消費できる", async () => {
    const store = memoryStore()
    const code = await issueHandoff({ store, challenge: CHALLENGE, sessionCipher: "cipher", next: "/ledger", now: NOW })

    // コードそのものは保存しない
    assert.equal(store.rows.some((r) => r.codeHash === code), false)

    const first = await consumeHandoff({ store, code, verifier: VERIFIER, now: NOW })
    assert.deepEqual(first, { sessionCipher: "cipher", next: "/ledger" })

    const second = await consumeHandoff({ store, code, verifier: VERIFIER, now: NOW })
    assert.equal(second, null)
})

test("verifierが違えば消費できず、コードはその時点で使えなくなる", async () => {
    const store = memoryStore()
    const code = await issueHandoff({ store, challenge: CHALLENGE, sessionCipher: "cipher", next: null, now: NOW })

    assert.equal(await consumeHandoff({ store, code, verifier: "w".repeat(43), now: NOW }), null)
    assert.equal(await consumeHandoff({ store, code, verifier: VERIFIER, now: NOW }), null)
})

test("期限を過ぎたコードは消費できない", async () => {
    const store = memoryStore()
    const code = await issueHandoff({ store, challenge: CHALLENGE, sessionCipher: "cipher", next: null, now: NOW })
    const later = new Date(NOW.getTime() + HANDOFF_TTL_MS + 1)

    assert.equal(await consumeHandoff({ store, code, verifier: VERIFIER, now: later }), null)
})

test("セッションの暗号化は鍵が無ければ失敗し、別の鍵では復号できない", () => {
    assert.throws(() => encryptSession("secret", undefined), /NATIVE_AUTH_HANDOFF_KEY/)

    const cipherText = encryptSession('{"accessToken":"a"}', "key-1")
    assert.equal(cipherText.includes("accessToken"), false)
    assert.equal(decryptSession(cipherText, "key-1"), '{"accessToken":"a"}')
    assert.throws(() => decryptSession(cipherText, "key-2"))
})

test("アプリからのログインの印（Cookie）は形が正しいときだけ読む", () => {
    const raw = encodeNativeLoginState({ challenge: CHALLENGE, next: "/receipts" })
    assert.deepEqual(parseNativeLoginState(raw), { challenge: CHALLENGE, next: "/receipts" })

    // 外部への遷移先は / へ落とす
    assert.deepEqual(parseNativeLoginState(JSON.stringify({ challenge: CHALLENGE, next: "//evil.example" })), {
        challenge: CHALLENGE,
        next: "/",
    })
    assert.equal(parseNativeLoginState(undefined), null)
    assert.equal(parseNativeLoginState("not-json"), null)
    assert.equal(parseNativeLoginState(JSON.stringify({ challenge: "bad", next: "/" })), null)
})

test("遷移先はサイト内の相対パスだけを通す", () => {
    assert.equal(safeNextPath("/ledger?tab=1"), "/ledger?tab=1")
    assert.equal(safeNextPath("https://evil.example"), "/")
    assert.equal(safeNextPath("//evil.example"), "/")
    assert.equal(safeNextPath("/\\evil.example"), "/")
    assert.equal(safeNextPath(null), "/")
})

test("アプリへ返すURLはアプリのスキームで、コードはエンコードされる", () => {
    assert.equal(nativeLoginCodeUrl("a+b"), "assetmanager://auth-callback?code=a%2Bb")
})
