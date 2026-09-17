import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    excludeDismissedAsDuplicate,
    findReplaceTargets,
    isPendingAccount,
    jstMonthKey,
    pickAlignedPurchaseDate,
    resolveCoveredMonths,
    type ReplaceSourceEntry,
    type ReplaceTargetLookup,
    type ReplaceTargetQuery,
} from "./replace-target"

function entry(overrides: Partial<ReplaceSourceEntry> = {}): ReplaceSourceEntry {
    return {
        id: 10300000001,
        date: "2026-09-11",
        amount: 3589,
        account: "楽天カード",
        toAccount: "",
        place: "ENEOS 高槻エコ・ステーション",
        name: "",
        comment: "",
        ...overrides,
    }
}

const query: ReplaceTargetQuery = {
    purchasedDate: "2026-09-11",
    totalAmount: 3589,
    cardAccountName: "楽天カード",
}

describe("isPendingAccount", () => {
    it("設定した反映待ち口座のidなら true", () => {
        assert.equal(isPendingAccount({ zaimAccountId: 5, name: "何か" }, 5), true)
    })

    it("idが未設定でも、口座名が「反映待ち」なら true", () => {
        assert.equal(isPendingAccount({ zaimAccountId: 5, name: "反映待ち" }, null), true)
        assert.equal(isPendingAccount({ zaimAccountId: 5, name: " 反映待ち " }, 9), true)
    })

    it("カードの口座は false", () => {
        assert.equal(isPendingAccount({ zaimAccountId: 7, name: "楽天カード" }, 5), false)
    })
})

describe("findReplaceTargets", () => {
    it("金額が一致し、日付が前後3日以内の明細を候補にする", () => {
        const result = findReplaceTargets(
            [
                entry({ id: 1 }),
                entry({ id: 2, date: "2026-09-14" }),
                entry({ id: 3, date: "2026-09-15" }),
                entry({ id: 4, amount: 3590 }),
            ],
            query,
            ["202609"]
        )
        assert.equal(result.state, "found")
        assert.deepEqual(
            result.targets.map((target) => target.id),
            [1, 2]
        )
        assert.equal(result.targets[0].sameAccount, true)
        assert.equal(result.targets[0].place, "ENEOS 高槻エコ・ステーション")
        assert.equal(result.targets[0].name, null)
    })

    it("振替と、当アプリが登録した行は候補にしない", () => {
        const result = findReplaceTargets(
            [
                entry({ toAccount: "楽天銀行" }),
                entry({ comment: "Asset Manager レシート取込 #42" }),
            ],
            query,
            ["202609"]
        )
        assert.equal(result.state, "notFound")
        assert.deepEqual(result.targets, [])
    })

    it("口座では絞らず、登録先と同じ口座を先に・日付の近い順に並べる", () => {
        const result = findReplaceTargets(
            [
                entry({ id: 1, account: "PayPayカード", date: "2026-09-11" }),
                entry({ id: 2, account: "楽天カード (自動連携)", date: "2026-09-13" }),
                entry({ id: 3, account: "楽天カード", date: "2026-09-12" }),
            ],
            query,
            ["202609"]
        )
        assert.deepEqual(
            result.targets.map((target) => [target.id, target.sameAccount]),
            [
                [3, true],
                [2, true],
                [1, false],
            ]
        )
    })

    it("登録先が分からなければ、どれも同じ口座とはみなさない", () => {
        const result = findReplaceTargets([entry()], { ...query, cardAccountName: null }, ["202609"])
        assert.equal(result.targets[0].sameAccount, false)
    })

    it("購入日・金額が無ければ探せない", () => {
        assert.equal(
            findReplaceTargets([entry()], { ...query, purchasedDate: null }, ["202609"]).state,
            "unknown"
        )
        assert.equal(
            findReplaceTargets([entry()], { ...query, totalAmount: null }, ["202609"]).state,
            "unknown"
        )
    })

    it("前後の日付が読めていない月にかかり、見つからなければ notCovered", () => {
        // 9/2 の前後3日は 8/30〜9/5。8月を読んでいなければ、見つからないとは言い切れない。
        const early = { ...query, purchasedDate: "2026-09-02" }
        assert.equal(findReplaceTargets([], early, ["202609"]).state, "notCovered")
        assert.equal(findReplaceTargets([], early, ["202608", "202609"]).state, "notFound")
        // 先月の明細は、先月を読んでいなければ notCovered
        assert.equal(
            findReplaceTargets([], { ...query, purchasedDate: "2026-08-20" }, ["202609"]).state,
            "notCovered"
        )
    })

    it("読めていない月にかかっていても、見つかれば found", () => {
        const result = findReplaceTargets(
            [entry({ date: "2026-09-02" })],
            { ...query, purchasedDate: "2026-09-02" },
            ["202609"]
        )
        assert.equal(result.state, "found")
    })
})

describe("resolveCoveredMonths", () => {
    const now = new Date("2026-09-17T12:00:00+09:00")

    it("AIDEが months を返していればそれを使う", () => {
        assert.deepEqual(resolveCoveredMonths(["202608", "202609"], null, now), ["202608", "202609"])
    })

    it("months が無ければ、巡回した時刻（JST）の月だけとみなす", () => {
        // UTCでは8月末だが、JSTでは9月1日
        assert.deepEqual(resolveCoveredMonths(null, "2026-08-31T15:30:00Z", now), ["202609"])
    })

    it("巡回時刻も無ければ、いまの月にする", () => {
        assert.deepEqual(resolveCoveredMonths(null, null, now), ["202609"])
        assert.equal(jstMonthKey(new Date("2026-09-30T15:00:00Z")), "202610")
    })
})

describe("pickAlignedPurchaseDate", () => {
    const align = (entries: ReplaceSourceEntry[], purchasedDate = "2026-09-11") =>
        pickAlignedPurchaseDate(
            findReplaceTargets(entries, { ...query, purchasedDate }, ["202609"]),
            purchasedDate
        )

    it("同じカードの連携明細が1件だけなら、その日付を返す", () => {
        assert.equal(align([entry({ date: "2026-09-13" })]), "2026-09-13")
    })

    it("日付が同じなら合わせない", () => {
        assert.equal(align([entry()]), null)
    })

    it("同じカードの候補が2件以上なら合わせない", () => {
        assert.equal(
            align([entry({ id: 1, date: "2026-09-12" }), entry({ id: 2, date: "2026-09-13" })]),
            null
        )
    })

    it("別の口座の明細しか無ければ合わせない", () => {
        assert.equal(align([entry({ date: "2026-09-13", account: "三井住友カード" })]), null)
    })

    it("別の口座の明細が混ざっていても、同じカードが1件なら合わせる", () => {
        assert.equal(
            align([
                entry({ id: 1, date: "2026-09-12", account: "三井住友カード" }),
                entry({ id: 2, date: "2026-09-10" }),
            ]),
            "2026-09-10"
        )
    })

    it("前後3日を超える明細では合わせない", () => {
        assert.equal(align([entry({ date: "2026-09-15" })]), null)
    })

    it("金額が違う明細では合わせない", () => {
        assert.equal(align([entry({ date: "2026-09-13", amount: 3590 })]), null)
    })

    it("当アプリが登録した明細では合わせない", () => {
        assert.equal(
            align([entry({ date: "2026-09-13", comment: "Asset Manager レシート取込 #12" })]),
            null
        )
    })

    it("購入日が無ければ合わせない", () => {
        const lookup = findReplaceTargets([entry()], query, ["202609"])
        assert.equal(pickAlignedPurchaseDate(lookup, null), null)
    })
})

describe("excludeDismissedAsDuplicate", () => {
    const found: ReplaceTargetLookup = {
        state: "found",
        targets: [
            {
                id: 111,
                date: "2026-09-11",
                amount: 3589,
                account: "楽天カード",
                place: "ENEOS 高槻エコ・ステーション",
                name: null,
                sameAccount: true,
            },
            {
                id: 222,
                date: "2026-09-12",
                amount: 3589,
                account: "楽天カード",
                place: "ENEOS 別の店舗",
                name: null,
                sameAccount: true,
            },
        ],
    }

    it("「重複の可能性」に出ている明細を候補から外す", () => {
        const result = excludeDismissedAsDuplicate(found, new Set([111]))
        assert.equal(result.state, "found")
        assert.deepEqual(
            result.targets.map((target) => target.id),
            [222]
        )
    })

    it("外した結果0件になったら notFound にする", () => {
        const result = excludeDismissedAsDuplicate(found, new Set([111, 222]))
        assert.deepEqual(result, { state: "notFound", targets: [] })
    })

    it("該当が無ければ同じ参照を返す", () => {
        const result = excludeDismissedAsDuplicate(found, new Set([999]))
        assert.equal(result, found)
    })

    it("found 以外の状態はそのまま返す", () => {
        const notFound: ReplaceTargetLookup = { state: "notFound", targets: [] }
        assert.equal(excludeDismissedAsDuplicate(notFound, new Set([111])), notFound)
    })

    it("除外する集合が空なら同じ参照を返す", () => {
        assert.equal(excludeDismissedAsDuplicate(found, new Set()), found)
    })
})
