import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { addDays, isRefundAmount, isRefundTarget, keepsCurrentRefundLink, mainCategoryOf, netBurden, rankReceiptCandidates, rankRefundCandidates, refundAmountOf, refundCandidateDateMax } from "./ledger-refund"

describe("返金の判定", () => {
    it("マイナスの支出と収入だけが返金", () => {
        assert.equal(isRefundAmount("EXPENSE", -100), true)
        assert.equal(isRefundAmount("INCOME", 100), true)
        assert.equal(isRefundAmount("EXPENSE", 100), false)
        assert.equal(isRefundAmount("TRANSFER", -100), false)
        assert.equal(refundAmountOf("EXPENSE", -3980), 3980)
        assert.equal(refundAmountOf("EXPENSE", 3980), 0)
    })
    it("返金元になれるのはプラスの支出だけ", () => {
        assert.equal(isRefundTarget("EXPENSE", 100), true)
        assert.equal(isRefundTarget("EXPENSE", -100), false)
        assert.equal(isRefundTarget("INCOME", 100), false)
    })
    it("実質負担額は0円を下回らない", () => {
        assert.equal(netBurden(12800, [3980]), 8820)
        assert.equal(netBurden(1000, [800, 800]), 0)
        assert.equal(netBurden(1000, []), 1000)
    })
})

describe("返金元の候補の並び", () => {
    const refund = { date: "2026-11-08", place: "ヨドバシ.com", amount: 3980 }
    it("同じ店・返金額以上・日付が近い順", () => {
        const ranked = rankRefundCandidates(
            refund,
            [
                { id: 1, date: "2026-11-07", place: "スーパー", amount: 5000 },
                { id: 2, date: "2026-10-28", place: "ヨドバシ.com", amount: 4200 },
                { id: 3, date: "2026-11-05", place: "ヨドバシ．ｃｏｍ", amount: 12800 },
                { id: 4, date: "2026-11-06", place: "ヨドバシ.com", amount: 1000 },
            ],
            10
        )
        assert.deepEqual(ranked.map((c) => c.id), [3, 2, 4, 1])
        assert.equal(ranked[0].sameStore, true)
        assert.equal(ranked[3].sameStore, false)
    })
    it("件数を絞る", () => {
        const many = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, date: "2026-11-01", place: null, amount: 100 }))
        assert.equal(rankRefundCandidates(refund, many, 20).length, 20)
    })
})

describe("まとめて払った分の受け取り（#1661）", () => {
    it("返金元の候補は受け取りの60日後の支払いまで", () => {
        assert.equal(refundCandidateDateMax("2026-11-20"), "2027-01-19")
        assert.equal(addDays("2026-12-31", 1), "2027-01-01")
        assert.equal(addDays("2026-03-01", -1), "2026-02-28")
    })
    it("主なカテゴリは、カテゴリの付いた品目のうち金額が最大のもの", () => {
        assert.equal(mainCategoryOf([{ amount: 4268, categoryId: 3 }, { amount: 9000, categoryId: 5 }, { amount: 20000, categoryId: null }]), 5)
        assert.equal(mainCategoryOf([{ amount: 1000, categoryId: 3 }, { amount: 1000, categoryId: 5 }]), 3)
        assert.equal(mainCategoryOf([{ amount: 1000, categoryId: null }]), null)
        assert.equal(mainCategoryOf([]), null)
    })
    it("先に受け取った分の候補は、支払い以下の金額・日付が近い順で、同じ近さなら前に受け取ったもの", () => {
        const ranked = rankReceiptCandidates(
            { date: "2026-11-26", amount: 26797 },
            [
                { id: 1, date: "2026-11-27", amount: 7500 },
                { id: 2, date: "2026-11-25", amount: 7500 },
                { id: 3, date: "2026-11-26", amount: 30000 },
                { id: 4, date: "2026-11-10", amount: 5000 },
            ],
            10
        )
        assert.deepEqual(
            ranked.map((c) => c.id),
            [2, 1, 4, 3]
        )
    })
})

describe("編集の保存で返金元を残すか（#1673）", () => {
    it("画面で変えていなければ、開いたあとに付け外しされた返金元を残す", () => {
        assert.equal(keepsCurrentRefundLink({ submitted: null, loaded: null, current: 5, eligible: true }), true)
        assert.equal(keepsCurrentRefundLink({ submitted: 5, loaded: 5, current: null, eligible: true }), true)
    })
    it("画面で変えたとき・DBが開いたときのままのときは、送られた値を書く", () => {
        assert.equal(keepsCurrentRefundLink({ submitted: 7, loaded: null, current: 5, eligible: true }), false)
        assert.equal(keepsCurrentRefundLink({ submitted: null, loaded: 5, current: 5, eligible: true }), false)
        assert.equal(keepsCurrentRefundLink({ submitted: 5, loaded: 5, current: 5, eligible: true }), false)
    })
    it("開いたときの値を送らない経路・返金でなくなった取引は、送られた値を書く", () => {
        assert.equal(keepsCurrentRefundLink({ submitted: null, loaded: undefined, current: 5, eligible: true }), false)
        assert.equal(keepsCurrentRefundLink({ submitted: null, loaded: null, current: 5, eligible: false }), false)
    })
})
