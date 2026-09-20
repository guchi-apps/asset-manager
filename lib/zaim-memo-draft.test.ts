import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
    buildZaimMemoDraft,
    buildZaimMemoRequestId,
    ZAIM_MEMO_MAX_LENGTH,
} from "./zaim-memo-draft"

const item = (name: string, amount: number, quantity = 1) => ({ name, quantity, amount })

describe("buildZaimMemoDraft", () => {
    it("品目名と金額を並べる。数量が1なら数量を出さない", () => {
        assert.equal(
            buildZaimMemoDraft([item("おにぎり", 158), item("牛乳", 436, 2)]),
            "おにぎり 158円／牛乳x2 436円"
        )
    })

    it("品目が無ければ空文字（画面は空欄から書き始める）", () => {
        assert.equal(buildZaimMemoDraft([]), "")
        assert.equal(buildZaimMemoDraft([item("  ", 100)]), "")
    })

    it("空白は1つに詰め、金額は整数へ丸める", () => {
        assert.equal(buildZaimMemoDraft([item(" 牛乳  1L ", 217.6)]), "牛乳 1L 218円")
    })

    it("上限を超えたら「ほかN件」にして、その分も含めて上限に収める", () => {
        const many = Array.from({ length: 12 }, (_, index) => item("商品" + index, 1000 + index))
        const draft = buildZaimMemoDraft(many)
        assert.ok(draft.length <= ZAIM_MEMO_MAX_LENGTH, draft)
        assert.match(draft, /／ほか\d+件$/)
        // 省いた件数が、並べた件数の残りと合っている。
        const shown = draft.split("／").length - 1
        const rest = Number(/ほか(\d+)件$/.exec(draft)![1])
        assert.equal(shown + rest, many.length)
    })

    it("1品目でも上限を超えるときは、その品目を上限で切る", () => {
        const draft = buildZaimMemoDraft([item("あ".repeat(200), 100)])
        assert.equal(draft.length, ZAIM_MEMO_MAX_LENGTH)
    })
})

describe("buildZaimMemoRequestId", () => {
    it("同じ明細・同じ本文なら同じキー（押し直しはZaimへ送らない）", () => {
        assert.equal(buildZaimMemoRequestId(12, "パン 150円"), buildZaimMemoRequestId(12, "パン 150円"))
    })

    it("本文が変わればキーも変わる（書き直したメモが黙って捨てられない）", () => {
        assert.notEqual(buildZaimMemoRequestId(12, "パン 150円"), buildZaimMemoRequestId(12, "パン 160円"))
    })

    it("明細が違えばキーも違う", () => {
        assert.notEqual(buildZaimMemoRequestId(12, "パン"), buildZaimMemoRequestId(13, "パン"))
    })
})
