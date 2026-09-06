import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { ZaimAideMoneyEntry } from "./zaim-aide-money"
import { buildZaimMasterIndex, mergeWebMoneyEntries, normalizeMasterName } from "./zaim-web-entries"

const accounts = [
    { zaimAccountId: 21351678, name: "スマートレシート" },
    { zaimAccountId: 100, name: "三井住友カード VISA" },
    { zaimAccountId: 200, name: "反映待ち" },
]

const genres = [
    { zaimGenreId: 10101, zaimCategoryId: 101, genreName: "食料品", categoryName: "食費" },
    { zaimGenreId: 10102, zaimCategoryId: 101, genreName: "外食", categoryName: "食費" },
    { zaimGenreId: 10201, zaimCategoryId: 102, genreName: "日用品", categoryName: "日用雑貨" },
]

const master = buildZaimMasterIndex(accounts, genres)

function webEntry(overrides: Partial<ZaimAideMoneyEntry> = {}): ZaimAideMoneyEntry {
    return {
        id: 1,
        date: "2026-09-02",
        amount: 1238,
        category: "食費",
        genre: "食料品",
        account: "スマートレシート",
        toAccount: "",
        place: "ライフ 高槻城西店",
        name: "牛乳",
        comment: "",
        ...overrides,
    }
}

const noKnownIds = { knownMoneyIds: new Set<number>() }

describe("normalizeMasterName", () => {
    it("全角・半角と空白の違いを吸収する", () => {
        assert.equal(normalizeMasterName("三井住友カード ＶＩＳＡ"), "三井住友カードVISA")
        assert.equal(normalizeMasterName(" スマート レシート "), "スマートレシート")
    })
})

describe("mergeWebMoneyEntries", () => {
    it("口座名・内訳名をマスタのidへ置き換える", () => {
        const { entries, breakdown } = mergeWebMoneyEntries([webEntry()], master, noKnownIds)

        assert.equal(breakdown.merged, 1)
        assert.deepEqual(entries, [
            {
                id: 1,
                date: "2026-09-02",
                amount: 1238,
                name: "牛乳",
                place: "ライフ 高槻城西店",
                fromAccountId: 21351678,
                categoryId: 101,
                genreId: 10101,
                comment: null,
                active: true,
            },
        ])
    })

    it("明細idが取れない行は落とす（二重登録を防げないため）", () => {
        const { entries, breakdown } = mergeWebMoneyEntries(
            [webEntry({ id: null })],
            master,
            noKnownIds
        )
        assert.deepEqual(entries, [])
        assert.equal(breakdown.noId, 1)
    })

    it("Zaim APIからも読めた明細は落とす（同じ明細を二度候補にしない）", () => {
        const { entries, breakdown } = mergeWebMoneyEntries([webEntry({ id: 7 })], master, {
            knownMoneyIds: new Set([7]),
        })
        assert.deepEqual(entries, [])
        assert.equal(breakdown.duplicate, 1)
    })

    it("同じ明細が一覧に二度出ても1件にする", () => {
        const { entries, breakdown } = mergeWebMoneyEntries(
            [webEntry(), webEntry()],
            master,
            noKnownIds
        )
        assert.equal(entries.length, 1)
        assert.equal(breakdown.duplicate, 1)
    })

    it("振替・出金元が空の行は支出ではないので落とす", () => {
        const { entries, breakdown } = mergeWebMoneyEntries(
            [
                webEntry({ id: 1, toAccount: "反映待ち" }),
                webEntry({ id: 2, account: "" }),
            ],
            master,
            noKnownIds
        )
        assert.deepEqual(entries, [])
        assert.equal(breakdown.notPayment, 2)
    })

    it("口座名がマスタに無ければ落とす（どのルールの明細か決められない）", () => {
        const { entries, breakdown } = mergeWebMoneyEntries(
            [webEntry({ account: "知らない口座" })],
            master,
            noKnownIds
        )
        assert.deepEqual(entries, [])
        assert.equal(breakdown.unknownAccount, 1)
    })

    it("同名の口座が複数あるときは引けないので落とす", () => {
        const ambiguous = buildZaimMasterIndex(
            [
                { zaimAccountId: 1, name: "サブ口座" },
                { zaimAccountId: 2, name: "サブ口座" },
            ],
            genres
        )
        const { entries, breakdown } = mergeWebMoneyEntries(
            [webEntry({ account: "サブ口座" })],
            ambiguous,
            noKnownIds
        )
        assert.deepEqual(entries, [])
        assert.equal(breakdown.unknownAccount, 1)
    })

    it("内訳名が引けなくても明細は残し、内訳未設定として数える", () => {
        const { entries, breakdown } = mergeWebMoneyEntries(
            [webEntry({ category: "食費", genre: "知らない内訳" })],
            master,
            noKnownIds
        )
        assert.equal(entries.length, 1)
        assert.equal(entries[0].categoryId, null)
        assert.equal(entries[0].genreId, null)
        assert.equal(breakdown.unknownGenre, 1)
    })

    it("カテゴリ名と内訳名の境目を取り違えない", () => {
        // 区切り無しで連結すると「食費A/B」と「食費/AB」が同じキーになる。
        const confusing = buildZaimMasterIndex(accounts, [
            { zaimGenreId: 1, zaimCategoryId: 11, genreName: "B", categoryName: "食費A" },
            { zaimGenreId: 2, zaimCategoryId: 12, genreName: "AB", categoryName: "食費" },
        ])
        const { entries } = mergeWebMoneyEntries(
            [
                webEntry({ id: 1, category: "食費A", genre: "B" }),
                webEntry({ id: 2, category: "食費", genre: "AB" }),
            ],
            confusing,
            noKnownIds
        )
        assert.deepEqual(
            entries.map((entry) => entry.genreId),
            [1, 2]
        )
    })

    it("カテゴリ名が読めなくても内訳名が一意なら引ける", () => {
        const { entries } = mergeWebMoneyEntries(
            [webEntry({ category: "", genre: "日用品" })],
            master,
            noKnownIds
        )
        assert.equal(entries[0].genreId, 10201)
        assert.equal(entries[0].categoryId, 102)
    })

    it("複製で作った明細のコメントは残す（複製元として拾い直さないため）", () => {
        const { entries } = mergeWebMoneyEntries(
            [webEntry({ comment: "Asset Manager 複製 #999" })],
            master,
            noKnownIds
        )
        assert.equal(entries[0].comment, "Asset Manager 複製 #999")
    })

    it("読んだ件数と落とした理由を数える", () => {
        const { breakdown } = mergeWebMoneyEntries(
            [webEntry({ id: 1 }), webEntry({ id: null }), webEntry({ id: 3, account: "" })],
            master,
            noKnownIds
        )
        assert.deepEqual(breakdown, {
            scanned: 3,
            merged: 1,
            duplicate: 0,
            noId: 1,
            notPayment: 1,
            unknownAccount: 0,
            unknownGenre: 0,
        })
    })
})
