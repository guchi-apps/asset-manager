import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseMoneyTransactions } from "./zaim-aide-money"
import { ZaimAideError } from "./zaim-aide"

const entry = {
    id: 10228209053,
    date: "2026-09-02",
    amount: 1238,
    category: "食費",
    genre: "食料品",
    account: "スマートレシート",
    toAccount: "",
    place: "ライフ 高槻城西店",
    name: "牛乳",
    comment: "",
}

describe("parseMoneyTransactions", () => {
    it("AIDEの応答をそのまま畳む", () => {
        const list = parseMoneyTransactions({
            empty: false,
            fetchedAt: "2026-09-06T11:35:00+09:00",
            ageMinutes: 42,
            stale: false,
            entries: [entry],
            note: "…",
        })

        assert.equal(list.empty, false)
        assert.equal(list.stale, false)
        assert.equal(list.fetchedAt, "2026-09-06T11:35:00+09:00")
        assert.equal(list.ageMinutes, 42)
        assert.deepEqual(list.entries, [entry])
    })

    it("まだ巡回していない応答は empty のまま0件で返す", () => {
        const list = parseMoneyTransactions({
            empty: true,
            fetchedAt: null,
            ageMinutes: null,
            stale: true,
            entries: [],
        })

        assert.equal(list.empty, true)
        assert.equal(list.stale, true)
        assert.equal(list.fetchedAt, null)
        assert.deepEqual(list.entries, [])
    })

    it("明細idを取れなかった行も落とさない（落とす判断は合流側に持たせる）", () => {
        const list = parseMoneyTransactions({ entries: [{ ...entry, id: null }] })
        assert.equal(list.entries.length, 1)
        assert.equal(list.entries[0].id, null)
    })

    it("日付・金額が読めない行だけを落とす", () => {
        const list = parseMoneyTransactions({
            entries: [
                { ...entry, date: "9月2日（水）" },
                { ...entry, amount: "￥1,238" },
                entry,
            ],
        })
        assert.equal(list.entries.length, 1)
        assert.equal(list.entries[0].date, "2026-09-02")
    })

    it("欠けている文字列項目は空文字で埋める", () => {
        const list = parseMoneyTransactions({
            entries: [{ id: 1, date: "2026-09-02", amount: 100 }],
        })
        assert.deepEqual(list.entries[0], {
            id: 1,
            date: "2026-09-02",
            amount: 100,
            category: "",
            genre: "",
            account: "",
            toAccount: "",
            place: "",
            name: "",
            comment: "",
        })
    })

    it("オブジェクトでない応答は ZaimAideError にする", () => {
        assert.throws(() => parseMoneyTransactions(null), ZaimAideError)
        assert.throws(() => parseMoneyTransactions("ok"), ZaimAideError)
    })
})
