import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    PROBE_COMMENT_MARKER,
    buildProbeCases,
    buildProbeComment,
    collectProbeEntries,
    findConflictingEntries,
    isProbeEntry,
    parseProbeTarget,
    resolveDefaultGenre,
    type ProbeMoneyEntry,
} from "./zaim-replace-probe"

const CARD = 21678522
const PENDING = 16525399
const GENRE = { categoryId: 101, genreId: 10101 }

function entry(overrides: Partial<ProbeMoneyEntry> & Pick<ProbeMoneyEntry, "id">): ProbeMoneyEntry {
    return {
        date: "2026-08-27",
        amount: 550,
        fromAccountId: CARD,
        categoryId: 101,
        genreId: 10101,
        name: "",
        place: "",
        comment: "",
        active: 1,
        ...overrides,
    }
}

describe("parseProbeTarget", () => {
    it("アプリで読んだ日付・金額・店舗名をそのまま的にする", () => {
        assert.deepEqual(
            parseProbeTarget({ date: "2026-08-27", amount: "550", place: " 東テスティバル " }),
            { date: "2026-08-27", amount: 550, place: "東テスティバル" }
        )
    })

    it("店舗名は省いてよい", () => {
        assert.equal(parseProbeTarget({ date: "2026-08-27", amount: 550 }).place, "")
    })

    it("日付の形が違えば黙って補正せずエラーにする", () => {
        for (const date of [undefined, "", "2026/08/27", "8-27", "2026-8-7"]) {
            assert.throws(() => parseProbeTarget({ date, amount: 550 }), /--date/)
        }
    })

    it("金額が正の整数でなければエラーにする", () => {
        for (const amount of [undefined, "", "0", "-550", "550.5", "五百五十"]) {
            assert.throws(() => parseProbeTarget({ date: "2026-08-27", amount }), /--amount/)
        }
    })
})

describe("findConflictingEntries", () => {
    const target = { date: "2026-08-27", amount: 550, place: "東テスティバル" }

    it("同じ日付・金額の明細があれば、置き換え前の連携明細ではないと分かる", () => {
        const found = findConflictingEntries(
            [
                entry({ id: 1 }),
                entry({ id: 2, amount: 551 }),
                entry({ id: 3, date: "2026-08-26" }),
            ],
            target
        )
        assert.deepEqual(
            found.map((item) => item.id),
            [1]
        )
    })

    it("口座をまたいで数える（反映待ちに同じ日付・金額があるものも見つける）", () => {
        const found = findConflictingEntries([entry({ id: 1, fromAccountId: PENDING })], target)
        assert.equal(found.length, 1)
    })

    it("集計対象外の明細は数えない", () => {
        assert.deepEqual(findConflictingEntries([entry({ id: 1, active: 0 })], target), [])
    })

    it("検証で作った明細は衝突として扱わない（--cleanup の守備範囲のため）", () => {
        const found = findConflictingEntries(
            [entry({ id: 1, comment: buildProbeComment("A") }), entry({ id: 2 })],
            target
        )
        assert.deepEqual(
            found.map((item) => item.id),
            [2]
        )
    })
})

describe("resolveDefaultGenre", () => {
    it("家計簿でいちばん使われているカテゴリ・内訳の組を借りる", () => {
        const genre = resolveDefaultGenre([
            entry({ id: 1, categoryId: 101, genreId: 10101 }),
            entry({ id: 2, categoryId: 101, genreId: 10101 }),
            entry({ id: 3, categoryId: 102, genreId: 10201 }),
        ])
        assert.deepEqual(genre, { categoryId: 101, genreId: 10101 })
    })

    it("内訳が決まっていない明細は数えない（Zaimの支出登録が受け付けないため）", () => {
        const genre = resolveDefaultGenre([
            entry({ id: 1, categoryId: 0, genreId: 0 }),
            entry({ id: 2, categoryId: 101, genreId: 0 }),
            entry({ id: 3, categoryId: 102, genreId: 10201 }),
        ])
        assert.deepEqual(genre, { categoryId: 102, genreId: 10201 })
    })

    it("同数なら内訳idの小さいほうを採り、実行のたびに結果が変わらないようにする", () => {
        const genre = resolveDefaultGenre([
            entry({ id: 1, categoryId: 102, genreId: 10201 }),
            entry({ id: 2, categoryId: 101, genreId: 10101 }),
        ])
        assert.deepEqual(genre, { categoryId: 101, genreId: 10101 })
    })

    it("決められなければ null（呼び出し側が指定を促す）", () => {
        assert.equal(resolveDefaultGenre([]), null)
        assert.equal(resolveDefaultGenre([entry({ id: 1, genreId: 0 })]), null)
    })
})

describe("buildProbeCases", () => {
    const target = { date: "2026-08-27", amount: 550, place: "東テスティバル" }
    const cases = buildProbeCases(target, { pendingAccountId: PENDING, cardAccountId: CARD }, GENRE)

    it("出金元だけが違う2件を作る", () => {
        assert.equal(cases.length, 2)
        assert.equal(cases[0].caseId, "A")
        assert.equal(cases[0].fromAccountId, PENDING)
        assert.equal(cases[1].caseId, "B")
        assert.equal(cases[1].fromAccountId, CARD)
    })

    it("日付・金額・店舗名は的の値をそのまま使う（置き換えの条件が日付と金額の一致のため）", () => {
        for (const probe of cases) {
            assert.equal(probe.date, "2026-08-27")
            assert.equal(probe.amount, 550)
            assert.equal(probe.place, "東テスティバル")
            assert.equal(probe.categoryId, GENRE.categoryId)
            assert.equal(probe.genreId, GENRE.genreId)
        }
    })

    it("品目は必ず入れる（置き換えの条件が「品目の記載があるか」のため）", () => {
        for (const probe of cases) assert.ok(probe.name.length > 0)
    })

    it("店舗名が空でも、店舗名を空のまま登録しない", () => {
        const [caseA] = buildProbeCases(
            { date: "2026-08-27", amount: 550, place: "" },
            { pendingAccountId: PENDING, cardAccountId: CARD },
            GENRE
        )
        assert.equal(caseA.place, "置き換え検証")
    })

    it("後片付けできるよう、コメントへ印を入れる", () => {
        assert.equal(cases[0].comment, `${PROBE_COMMENT_MARKER} [A]`)
        assert.equal(cases[1].comment, buildProbeComment("B"))
        for (const probe of cases) assert.ok(isProbeEntry(probe))
    })
})

describe("collectProbeEntries", () => {
    it("印の付いた明細だけを後片付けの対象にする", () => {
        const found = collectProbeEntries([
            entry({ id: 1, comment: buildProbeComment("A") }),
            entry({ id: 2, comment: "Asset Manager レシート取込 #18" }),
            entry({ id: 3, comment: "" }),
            entry({ id: 4, comment: buildProbeComment("B") }),
        ])
        assert.deepEqual(
            found.map((item) => item.id),
            [1, 4]
        )
    })
})
