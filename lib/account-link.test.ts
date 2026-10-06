import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
    resolveAccountLink,
    verifiedProviderEmail,
    type AccountLinkAuthUser,
    type AccountLinkStore,
    type AccountLinkUserRow,
} from "./account-link"
import { isAuthUnreachable } from "./auth-errors"

function uniqueError() {
    return Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
}

/** メモリ上のUserテーブル。email・supabaseUserIdの一意制約を再現する */
function memoryStore(rows: AccountLinkUserRow[]) {
    const calls = { relink: 0, create: 0 }
    const store: AccountLinkStore = {
        async findBySupabaseUserId(id) {
            return rows.find((row) => row.supabaseUserId === id) ?? null
        },
        async findByEmail(email) {
            return rows.find((row) => row.email?.toLowerCase() === email.toLowerCase()) ?? null
        },
        async relink(userId, expected, next) {
            calls.relink++
            if (rows.some((row) => row.supabaseUserId === next && row.id !== userId)) throw uniqueError()
            const row = rows.find((candidate) => candidate.id === userId && candidate.supabaseUserId === expected)
            if (!row) return false
            row.supabaseUserId = next
            return true
        },
        async create({ email, supabaseUserId }) {
            calls.create++
            if (rows.some((row) => row.email?.toLowerCase() === email.toLowerCase() || row.supabaseUserId === supabaseUserId)) {
                throw uniqueError()
            }
            const row = { id: `user-${rows.length + 1}`, email, supabaseUserId }
            rows.push(row)
            return row
        },
    }
    return { store, rows, calls }
}

function googleUser(overrides: Partial<AccountLinkAuthUser> = {}): AccountLinkAuthUser {
    return {
        id: "auth-new",
        email: "owner@example.com",
        email_confirmed_at: "2026-10-06T00:00:00Z",
        identities: [{ provider: "google", identity_data: { email: "owner@example.com", email_verified: true } }],
        ...overrides,
    }
}

describe("resolveAccountLink", () => {
    it("通常ログイン: supabaseUserIdで見つかればそのまま使う", async () => {
        const { store, calls } = memoryStore([{ id: "user-1", email: "owner@example.com", supabaseUserId: "auth-new" }])
        assert.deepEqual(await resolveAccountLink(store, googleUser()), { kind: "linked", userId: "user-1" })
        assert.equal(calls.relink + calls.create, 0)
    })

    it("新規登録: 同じメールのUserが無ければ作成する", async () => {
        const { store, rows } = memoryStore([{ id: "user-1", email: "other@example.com", supabaseUserId: "auth-other" }])
        const result = await resolveAccountLink(store, googleUser())
        assert.deepEqual(result, { kind: "created", userId: "user-2" })
        assert.equal(rows.length, 2)
    })

    it("ID不一致: 旧IDが残っていても、確認済みメールならUser.idを保って付け替える", async () => {
        const { store, rows, calls } = memoryStore([{ id: "user-1", email: "owner@example.com", supabaseUserId: "auth-old" }])
        const result = await resolveAccountLink(store, googleUser())
        assert.deepEqual(result, { kind: "relinked", userId: "user-1", replacedPreviousId: true })
        assert.deepEqual(rows, [{ id: "user-1", email: "owner@example.com", supabaseUserId: "auth-new" }])
        assert.equal(calls.create, 0)
    })

    it("NextAuthからの移行で未紐付けのUserも、確認済みメールなら紐付ける", async () => {
        const { store } = memoryStore([{ id: "user-1", email: "Owner@Example.com", supabaseUserId: null }])
        assert.deepEqual(await resolveAccountLink(store, googleUser()), {
            kind: "relinked",
            userId: "user-1",
            replacedPreviousId: false,
        })
    })

    const unverifiedCases: Array<[string, Partial<AccountLinkAuthUser>]> = [
        ["プロバイダがメールを確認していない", {
            identities: [{ provider: "google", identity_data: { email: "owner@example.com", email_verified: false } }],
        }],
        ["Supabase側でメールが未確認", { email_confirmed_at: null }],
        ["Google以外の本人情報しか無い", {
            identities: [{ provider: "email", identity_data: { email: "owner@example.com", email_verified: true } }],
        }],
        ["プロバイダのメールとログインのメールが違う", {
            identities: [{ provider: "google", identity_data: { email: "attacker@example.com", email_verified: true } }],
        }],
        ["本人情報が無い（user_metadataだけ一致）", { identities: [] }],
    ]
    for (const [label, overrides] of unverifiedCases) {
        it(`偽装・未確認: ${label}なら既存Userを変更しない`, async () => {
            const { store, rows, calls } = memoryStore([{ id: "user-1", email: "owner@example.com", supabaseUserId: "auth-old" }])
            const result = await resolveAccountLink(store, googleUser(overrides))
            assert.deepEqual(result, { kind: "rejected", reason: "unverified" })
            assert.equal(rows[0].supabaseUserId, "auth-old")
            assert.equal(calls.relink + calls.create, 0)
        })
    }

    it("メールが無いSupabaseユーザーは、紐付け済みでなければ拒否する", async () => {
        const { store } = memoryStore([])
        assert.deepEqual(await resolveAccountLink(store, googleUser({ email: null })), {
            kind: "rejected",
            reason: "missing_email",
        })
    })

    it("競合: 付け替えの直前に別のリクエストが同じIDで紐付けたら、その結果を使う", async () => {
        const { store, rows } = memoryStore([{ id: "user-1", email: "owner@example.com", supabaseUserId: "auth-old" }])
        const original = store.relink
        store.relink = async (userId, expected, next) => {
            rows[0].supabaseUserId = "auth-new"
            return original(userId, expected, next)
        }
        assert.deepEqual(await resolveAccountLink(store, googleUser()), { kind: "linked", userId: "user-1" })
    })

    it("競合: 別のIDへ書き換わり続けて確定できなければ、変更せずに拒否する", async () => {
        const { store, rows } = memoryStore([{ id: "user-1", email: "owner@example.com", supabaseUserId: "auth-old" }])
        let n = 0
        store.relink = async () => {
            rows[0].supabaseUserId = `auth-other-${n++}`
            return false
        }
        assert.deepEqual(await resolveAccountLink(store, googleUser()), { kind: "rejected", reason: "conflict" })
        assert.notEqual(rows[0].supabaseUserId, "auth-new")
    })

    it("競合: 新規作成が同時に走って一意制約に当たったら、読み直して作成済みのUserを使う", async () => {
        const { store, rows } = memoryStore([])
        const original = store.create
        store.create = async (input) => {
            await original(input) // 先に別のリクエストが作成した
            return original(input)
        }
        assert.deepEqual(await resolveAccountLink(store, googleUser()), { kind: "linked", userId: "user-1" })
        assert.equal(rows.length, 1)
    })

    it("保存失敗: 一意制約違反以外のDBエラーはそのまま投げ、Userを変更しない", async () => {
        const { store, rows } = memoryStore([{ id: "user-1", email: "owner@example.com", supabaseUserId: "auth-old" }])
        store.relink = async () => {
            throw new Error("Can't reach database server")
        }
        await assert.rejects(resolveAccountLink(store, googleUser()), /Can't reach database server/)
        assert.equal(rows[0].supabaseUserId, "auth-old")
    })
})

describe("verifiedProviderEmail", () => {
    it("Googleが確認済みのメールを小文字で返す", () => {
        assert.equal(
            verifiedProviderEmail(googleUser({
                email: "Owner@Example.com",
                identities: [{ provider: "google", identity_data: { email: "OWNER@example.com", email_verified: true } }],
            })),
            "owner@example.com"
        )
    })
})

describe("isAuthUnreachable", () => {
    it("通信不達・5xx・レート制限は「今は確認できない」として扱う", () => {
        assert.equal(isAuthUnreachable({ name: "AuthRetryableFetchError", status: 0 }), true)
        assert.equal(isAuthUnreachable({ name: "AuthRetryableFetchError", status: 503 }), true)
        assert.equal(isAuthUnreachable({ name: "AuthApiError", status: 429 }), true)
    })

    it("古いrefresh tokenはセッション無効として扱い、再ログインへ進める", () => {
        assert.equal(isAuthUnreachable({ name: "AuthApiError", status: 400 }), false)
        assert.equal(isAuthUnreachable({ name: "AuthSessionMissingError", status: 400 }), false)
        assert.equal(isAuthUnreachable(null), false)
    })
})
