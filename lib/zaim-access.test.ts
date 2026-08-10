import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { getZaimAllowedEmails, isZaimAllowedEmail } from "./zaim-access"

const original = process.env.ZAIM_SYNC_USER_EMAIL

beforeEach(() => {
    delete process.env.ZAIM_SYNC_USER_EMAIL
})

afterEach(() => {
    if (original === undefined) delete process.env.ZAIM_SYNC_USER_EMAIL
    else process.env.ZAIM_SYNC_USER_EMAIL = original
})

describe("isZaimAllowedEmail", () => {
    it("未設定なら誰も許可しない", () => {
        assert.equal(isZaimAllowedEmail("owner@example.com"), false)
    })

    it("設定したメールアドレスだけを許可する", () => {
        process.env.ZAIM_SYNC_USER_EMAIL = "owner@example.com"
        assert.equal(isZaimAllowedEmail("owner@example.com"), true)
        assert.equal(isZaimAllowedEmail("other@example.com"), false)
    })

    it("大文字小文字と前後の空白を無視する", () => {
        process.env.ZAIM_SYNC_USER_EMAIL = " Owner@Example.com "
        assert.equal(isZaimAllowedEmail("owner@example.com"), true)
        assert.equal(isZaimAllowedEmail(" OWNER@EXAMPLE.COM "), true)
    })

    it("カンマ区切りで複数のメールアドレスを許可できる", () => {
        process.env.ZAIM_SYNC_USER_EMAIL = "a@example.com,b@example.com"
        assert.deepEqual(getZaimAllowedEmails(), ["a@example.com", "b@example.com"])
        assert.equal(isZaimAllowedEmail("b@example.com"), true)
        assert.equal(isZaimAllowedEmail("c@example.com"), false)
    })

    it("メールアドレスが無いユーザーは許可しない", () => {
        process.env.ZAIM_SYNC_USER_EMAIL = "owner@example.com"
        assert.equal(isZaimAllowedEmail(null), false)
        assert.equal(isZaimAllowedEmail(""), false)
    })
})
