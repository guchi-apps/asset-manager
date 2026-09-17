import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    applyAiSuggestions,
    buildHistorySuggestions,
    isGenreUndecided,
    isPreselectable,
    isSuggestableEntry,
    isTruncatedProductLabel,
    mergeSuggestableEntries,
    resolveSuggestionLabel,
    suggestionOriginsToReplace,
    SUGGESTION_AI_CONFIDENCE_CAP,
    toZaimPaymentRows,
    type GenreMasterEntry,
    type SuggestableMoneyEntry,
} from "./zaim-genre-suggest"
import type { ClassificationRule } from "./receipt-classify"

const FOOD_GENRE = 10101
const OTHER_GENRE = 10199
const PHONE_GENRE = 20301

const genreById = new Map<number, GenreMasterEntry>([
    [
        FOOD_GENRE,
        { zaimGenreId: FOOD_GENRE, zaimCategoryId: 101, genreName: "食料品", categoryName: "食費" },
    ],
    [
        OTHER_GENRE,
        { zaimGenreId: OTHER_GENRE, zaimCategoryId: 101, genreName: "その他", categoryName: "食費" },
    ],
    [
        PHONE_GENRE,
        {
            zaimGenreId: PHONE_GENRE,
            zaimCategoryId: 203,
            genreName: "携帯電話",
            categoryName: "通信",
        },
    ],
])

function entry(overrides: Partial<SuggestableMoneyEntry> & { id: number }): SuggestableMoneyEntry {
    return {
        date: "2026-08-28",
        amount: 108,
        name: "サントリー 天然水 550ml",
        place: "セブン-イレブン 西新井店",
        fromAccountId: 555,
        categoryId: 101,
        genreId: null,
        active: true,
        ...overrides,
    }
}

const rules: ClassificationRule[] = [
    {
        normalizedName: "サントリー天然水550ml",
        storeName: "",
        zaimCategoryId: 101,
        zaimGenreId: FOOD_GENRE,
        categoryName: "食費",
        genreName: "食料品",
        correctionCount: 8,
    },
]

describe("isGenreUndecided", () => {
    it("treats a missing or zero genre as undecided", () => {
        assert.equal(isGenreUndecided({ genreId: null }, genreById), true)
        // Zaim APIは未分類の支出に 0 を返す。
        assert.equal(isGenreUndecided({ genreId: 0 }, genreById), true)
    })

    it("treats a genre that is not in the master as undecided", () => {
        // 画面の選択肢に出せない内訳は、利用者から見れば空欄と変わらない。
        assert.equal(isGenreUndecided({ genreId: 999999 }, genreById), true)
    })

    it('treats "その他" as undecided', () => {
        assert.equal(isGenreUndecided({ genreId: OTHER_GENRE }, genreById), true)
    })

    it("leaves a decided genre alone", () => {
        assert.equal(isGenreUndecided({ genreId: FOOD_GENRE }, genreById), false)
    })
})

describe("isSuggestableEntry", () => {
    it("skips entries excluded from totals in Zaim", () => {
        assert.equal(isSuggestableEntry(entry({ id: 1, active: false }), genreById), false)
    })

    it("skips non-positive amounts", () => {
        assert.equal(isSuggestableEntry(entry({ id: 2, amount: 0 }), genreById), false)
        assert.equal(isSuggestableEntry(entry({ id: 3, amount: -100 }), genreById), false)
    })

    it("keeps undecided payments", () => {
        assert.equal(isSuggestableEntry(entry({ id: 4 }), genreById), true)
    })

    it("skips payments that already have a genre", () => {
        assert.equal(isSuggestableEntry(entry({ id: 5, genreId: FOOD_GENRE }), genreById), false)
    })
})

describe("toZaimPaymentRows", () => {
    const accountNameById = new Map([[555, "楽天カード"]])

    it("内訳が決まっている明細も含め、内訳・口座の名前を付けて日付の新しい順に返す（Issue #466）", () => {
        const rows = toZaimPaymentRows(
            [
                entry({ id: 1, date: "2026-08-27", genreId: FOOD_GENRE }),
                entry({ id: 2, date: "2026-08-29", origin: "WEB", fromAccountId: 999 }),
                entry({ id: 3, date: "2026-08-27", genreId: OTHER_GENRE }),
            ],
            genreById,
            accountNameById
        )
        assert.deepEqual(
            rows.map((row) => row.id),
            [2, 3, 1]
        )
        assert.deepEqual(
            { ...rows[2] },
            {
                id: 1,
                origin: "API",
                date: "2026-08-27",
                amount: 108,
                name: "サントリー 天然水 550ml",
                place: "セブン-イレブン 西新井店",
                accountName: "楽天カード",
                categoryName: "食費",
                genreName: "食料品",
                undecided: false,
            }
        )
        // マスタに無い口座は名前なし、「その他」は内訳の名前を出しつつ未決定として扱う。
        assert.equal(rows[0].accountName, null)
        assert.equal(rows[0].origin, "WEB")
        assert.equal(rows[0].undecided, true)
        assert.equal(rows[1].genreName, "その他")
        assert.equal(rows[1].undecided, true)
    })

    it("集計対象外・金額0以下は出さない", () => {
        const rows = toZaimPaymentRows(
            [entry({ id: 1, active: false }), entry({ id: 2, amount: 0 }), entry({ id: 3 })],
            genreById,
            accountNameById
        )
        assert.deepEqual(
            rows.map((row) => row.id),
            [3]
        )
    })
})

describe("resolveSuggestionLabel", () => {
    it("falls back to the store name when the item name is empty", () => {
        assert.equal(resolveSuggestionLabel({ name: null, place: "NTTドコモ" }), "NTTドコモ")
        assert.equal(resolveSuggestionLabel({ name: "  ", place: "NTTドコモ" }), "NTTドコモ")
    })

    it("returns an empty string when neither is available", () => {
        assert.equal(resolveSuggestionLabel({ name: null, place: null }), "")
    })
})

describe("buildHistorySuggestions", () => {
    it("fills in the genre from the classification history with full confidence", () => {
        const [draft] = buildHistorySuggestions([entry({ id: 10 })], { rules })

        assert.equal(draft.zaimGenreId, FOOD_GENRE)
        assert.equal(draft.zaimCategoryId, 101)
        assert.equal(draft.genreName, "食料品")
        assert.equal(draft.confidence, 1)
        assert.equal(draft.source, "HISTORY")
        assert.equal(draft.reason, "過去 8 回同じ分類")
        assert.equal(isPreselectable(draft), true)
    })

    it("leaves the genre empty when nothing matches", () => {
        const [draft] = buildHistorySuggestions([entry({ id: 11, name: "謎の商品" })], { rules })

        assert.equal(draft.zaimGenreId, null)
        assert.equal(draft.source, "AI")
        assert.equal(draft.reason, "分類履歴に一致なし")
        // 提案が無い行を最初からチェックすると、内訳なしで反映しようとして必ず失敗する。
        assert.equal(isPreselectable(draft), false)
    })

    it("says so when there is no name to classify by", () => {
        const [draft] = buildHistorySuggestions([entry({ id: 12, name: null, place: null })], {
            rules,
        })

        assert.equal(draft.reason, "品目名・店舗名がなく判定できない")
    })

    it("carries the account name for display", () => {
        const [draft] = buildHistorySuggestions([entry({ id: 13 })], {
            rules,
            accountNameById: new Map([[555, "三井住友カード"]]),
        })

        assert.equal(draft.accountName, "三井住友カード")
    })
})

describe("applyAiSuggestions", () => {
    it("caps the AI confidence so it never preselects", () => {
        const drafts = buildHistorySuggestions([entry({ id: 20, name: "謎の商品" })], { rules })
        const merged = applyAiSuggestions(
            drafts,
            [0],
            [{ index: 0, zaimGenreId: PHONE_GENRE, confidence: 0.99 }],
            genreById
        )

        assert.equal(merged[0].zaimGenreId, PHONE_GENRE)
        assert.equal(merged[0].confidence, SUGGESTION_AI_CONFIDENCE_CAP)
        assert.equal(merged[0].source, "AI")
        assert.equal(isPreselectable(merged[0]), false)
    })

    it("drops genres that are not in the master", () => {
        const drafts = buildHistorySuggestions([entry({ id: 21, name: "謎の商品" })], { rules })
        const merged = applyAiSuggestions(
            drafts,
            [0],
            [{ index: 0, zaimGenreId: 999999, confidence: 0.9 }],
            genreById
        )

        // 実在しないidを提案するとZaimへの反映で必ず失敗する。
        assert.equal(merged[0].zaimGenreId, null)
    })

    it("does not touch rows that were decided by history", () => {
        const drafts = buildHistorySuggestions([entry({ id: 22 })], { rules })
        const merged = applyAiSuggestions(drafts, [], [], genreById)

        assert.equal(merged[0].zaimGenreId, FOOD_GENRE)
        assert.equal(merged[0].confidence, 1)
    })
})

describe("mergeSuggestableEntries (Issue #420)", () => {
    it("marks API entries and Web entries with their origin", () => {
        const merged = mergeSuggestableEntries([entry({ id: 1 })], [entry({ id: 2 })])

        assert.deepEqual(
            merged.map((item) => [item.id, item.origin]),
            [
                [1, "API"],
                [2, "WEB"],
            ]
        )
    })

    it("keeps the API entry when the same money id is also in the Web list", () => {
        // Web版の一覧は公式APIで読める明細も並べる。二重に提案しない。
        const merged = mergeSuggestableEntries(
            [entry({ id: 1, name: "APIの品目" })],
            [entry({ id: 1, name: "Web版の品目" }), entry({ id: 3 })]
        )

        assert.equal(merged.length, 2)
        assert.equal(merged[0].origin, "API")
        assert.equal(merged[0].name, "APIの品目")
        assert.equal(merged[1].id, 3)
    })

    it("carries the origin into the drafts", () => {
        const drafts = buildHistorySuggestions(
            mergeSuggestableEntries([entry({ id: 1 })], [entry({ id: 2, name: "謎の商品" })]),
            { rules }
        )

        assert.equal(drafts[0].origin, "API")
        assert.equal(drafts[1].origin, "WEB")
    })

    it("treats entries without an origin as API", () => {
        const [draft] = buildHistorySuggestions([entry({ id: 1 })], { rules })
        assert.equal(draft.origin, "API")
    })
})

describe("Web-origin suggestions (Issue #420)", () => {
    it("is preselected when decided by history, same as API-origin (Issue #421)", () => {
        const [draft] = buildHistorySuggestions(mergeSuggestableEntries([], [entry({ id: 1 })]), {
            rules,
        })

        assert.equal(draft.source, "HISTORY")
        assert.equal(isPreselectable(draft), true)
    })

    it("keeps Web-origin pending suggestions when the Web list could not be read", () => {
        // AIDEが未設定・停止中の回に消すと、画面で選び直した内訳ごと消える。
        assert.deepEqual(suggestionOriginsToReplace(false), ["API"])
        assert.deepEqual(suggestionOriginsToReplace(true), ["API", "WEB"])
    })
})

describe("isTruncatedProductLabel (Issue #421)", () => {
    it("treats a name ending with the ellipsis mark as truncated", () => {
        // Web版の一覧は複数品目の明細で先頭の1件だけを出し、末尾を「…」にする。
        assert.equal(isTruncatedProductLabel("ハーゲンダッツ ミニカップ…"), true)
    })

    it("does not treat a normal name as truncated", () => {
        assert.equal(isTruncatedProductLabel("サントリー 天然水 550ml"), false)
    })

    it("does not treat three literal dots as the ellipsis mark", () => {
        assert.equal(isTruncatedProductLabel("がまん..."), false)
    })

    it("treats missing labels as not truncated", () => {
        assert.equal(isTruncatedProductLabel(null), false)
        assert.equal(isTruncatedProductLabel(undefined), false)
        assert.equal(isTruncatedProductLabel(""), false)
    })
})
