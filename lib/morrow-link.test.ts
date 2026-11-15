import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildMorrowMailUrl } from "./morrow-link"

describe("buildMorrowMailUrl", () => {
    it("GmailのメッセージidからMorrowのメール詳細URLを作る", () => {
        assert.equal(buildMorrowMailUrl("18c3f2a9b7d4e5f1"), "https://aide-bot.gucchii.com/mail/18c3f2a9b7d4e5f1")
    })

    it("複数アカウント構成の接頭辞（~）をそのまま使う", () => {
        assert.equal(buildMorrowMailUrl("main~18c3f2a9"), "https://aide-bot.gucchii.com/mail/main~18c3f2a9")
    })

    it("空・未指定・Morrowが受け付けない形ならnull", () => {
        assert.equal(buildMorrowMailUrl(null), null)
        assert.equal(buildMorrowMailUrl(undefined), null)
        assert.equal(buildMorrowMailUrl(""), null)
        assert.equal(buildMorrowMailUrl("a/b"), null)
        assert.equal(buildMorrowMailUrl("a b"), null)
        assert.equal(buildMorrowMailUrl("a".repeat(321)), null)
    })
})
