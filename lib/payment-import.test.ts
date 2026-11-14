import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
    applyYenConversion,
    decidePaymentImport,
    describeAmountNote,
    isApproximateAmount,
    ITEMS_TOTAL_MISMATCH_REASON,
    validatePaymentImportInput,
} from "@/lib/payment-import"
import { describeConversion, formatRate, needsYenConversion } from "@/lib/foreign-amount"

const rule = {
    normalizedName: "netflix",
    storeName: "Netflix",
    ledgerCategoryId: 2,
    categoryName: "通信費",
    genreName: "インターネット接続料",
    correctionCount: 2,
}

describe("payment import", () => {
    it("明確な入力を自動反映対象にする", () => {
        assert.equal(decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.95 }, rule).status, "imported")
    })

    it("分類が不明・信頼度が低いなら確認待ちにする", () => {
        assert.equal(decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.95 }, null).status, "pendingReview")
        assert.equal(decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.5 }, rule).status, "pendingReview")
    })

    it("口座の手がかりが無くても止めず、口座未定で登録する対象にする（Issue #859）", () => {
        const decision = decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.95 }, rule)
        assert.equal(decision.status, "imported")
        assert.equal(decision.ledgerCategoryId, 2)
        assert.equal(decision.genreName, "インターネット接続料")
    })

    it("家計簿のカテゴリへ移せなかった旧い規則は、規則が無いのと同じに扱う（Issue #843）", () => {
        const legacy = { ...rule, ledgerCategoryId: null }
        const decision = decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.95 }, legacy)
        assert.equal(decision.status, "pendingReview")
        assert.equal(decision.ledgerCategoryId, null)
        assert.equal(decision.categoryName, null)
    })

    it("信頼度が低いときも、規則のカテゴリは下書きとして残す", () => {
        const decision = decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.5 }, rule)
        assert.equal(decision.status, "pendingReview")
        assert.equal(decision.ledgerCategoryId, 2)
    })

    it("中分類を持たない大分類の規則は、中分類名を null にする", () => {
        const decision = decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.95 }, { ...rule, genreName: "" })
        assert.equal(decision.status, "imported")
        assert.equal(decision.genreName, null)
    })

    it("使用量を受け取り、省略もできる", () => {
        const base = { source: "gmail", gmailMessageId: "m1", date: "2026-08-30", amount: 7842, place: "関西電力", name: "電気料金" }
        assert.equal(validatePaymentImportInput({ ...base, usage: " 258 kWh " }).usage, "258 kWh")
        assert.equal(validatePaymentImportInput(base).usage, null)
        assert.equal(validatePaymentImportInput({ ...base, usage: "" }).usage, null)
    })

    it("使用量が文字列でない・長すぎる場合は弾く", () => {
        const base = { source: "gmail", gmailMessageId: "m1", date: "2026-08-30", amount: 7842, place: "関西電力", name: "電気料金" }
        assert.throws(() => validatePaymentImportInput({ ...base, usage: 258 }))
        assert.throws(() => validatePaymentImportInput({ ...base, usage: "k".repeat(33) }))
    })

    it("入力形式を検証する", () => {
        assert.throws(() => validatePaymentImportInput({ source: "gmail", gmailMessageId: "m1", date: "2026-02-30", amount: 100, place: "店", name: "商品" }))
        assert.equal(validatePaymentImportInput({ source: "gmail", gmailMessageId: "m1", date: "2026-08-30", amount: 100, place: "店", name: "商品" }).amount, 100)
    })

    it("時刻付きの購入日時を受け取る（Issue #323）", () => {
        const base = { source: "gmail", gmailMessageId: "m1", amount: 100, place: "店", name: "商品" }
        assert.equal(validatePaymentImportInput({ ...base, date: "2026-08-30T14:23" }).date, "2026-08-30T14:23")
        assert.equal(validatePaymentImportInput({ ...base, date: " 2026-08-30T14:23:45 " }).date, "2026-08-30T14:23:45")
        assert.equal(validatePaymentImportInput({ ...base, date: "2026-08-30T05:23:00Z" }).date, "2026-08-30T05:23:00Z")
        // 日付だけの従来の入力も引き続き受け付ける
        assert.equal(validatePaymentImportInput({ ...base, date: "2026-08-30" }).date, "2026-08-30")
    })

    it("時刻の形が不正なものは弾く（Issue #323）", () => {
        const base = { source: "gmail", gmailMessageId: "m1", amount: 100, place: "店", name: "商品" }
        assert.throws(() => validatePaymentImportInput({ ...base, date: "2026-08-30T14" }))
        assert.throws(() => validatePaymentImportInput({ ...base, date: "2026-08-30 14:23" }))
        assert.throws(() => validatePaymentImportInput({ ...base, date: "2026-08-30T25:00" }))
    })

    it("car-careからの取り込みはexternalIdを一意キーとして受け付ける（Issue #373）", () => {
        const input = validatePaymentImportInput({
            source: "car-care",
            externalId: "fuel:clfuel0001",
            date: "2026-09-05",
            amount: 6480,
            place: "エネオス 西新井店",
            name: "ガソリン",
            usage: "35.2L",
            confidence: 1,
            accountHint: "楽天カード",
            sourceMetadata: { app: "car-care", fuelLogId: "clfuel0001" },
        })
        assert.equal(input.source, "car-care")
        assert.equal(input.externalId, "fuel:clfuel0001")
    })

    it("car-careはexternalIdが無ければ弾く（Issue #373）", () => {
        assert.throws(() => validatePaymentImportInput({ source: "car-care", date: "2026-09-05", amount: 6480, place: "エネオス", name: "ガソリン" }))
    })

    it("許可されていないsourceは弾く（Issue #373）", () => {
        assert.throws(() => validatePaymentImportInput({ source: "unknown-app", externalId: "1", date: "2026-09-05", amount: 100, place: "店", name: "商品" }))
    })

    describe("金額の精度（Issue #483）", () => {
        const base = { source: "gmail", gmailMessageId: "m1", date: "2026-09-14", amount: 1500, place: "Apple", name: "Apple" }

        it("外貨建てなら指定が無くても概算にする", () => {
            const input = validatePaymentImportInput({ ...base, originalAmount: 9.99, originalCurrency: "usd" })
            assert.equal(input.originalCurrency, "USD")
            assert.equal(input.originalAmount, 9.99)
            assert.equal(isApproximateAmount(input), true)
            assert.equal(describeAmountNote(input), "USD 9.99 を円に換算した金額")
        })

        it("明示の指定を優先し、円建てだけなら概算にしない", () => {
            assert.equal(isApproximateAmount(validatePaymentImportInput(base)), false)
            assert.equal(isApproximateAmount(validatePaymentImportInput({ ...base, originalCurrency: "JPY" })), false)
            assert.equal(isApproximateAmount(validatePaymentImportInput({ ...base, amountApproximate: true })), true)
            assert.equal(isApproximateAmount(validatePaymentImportInput({ ...base, amountApproximate: false, originalCurrency: "USD" })), false)
        })

        it("送られてきた理由はそのまま使う", () => {
            const input = validatePaymentImportInput({ ...base, originalCurrency: "USD", amountNote: " 1ドル=150.2円で換算 " })
            assert.equal(describeAmountNote(input), "1ドル=150.2円で換算")
        })

        it("不正な値は弾く", () => {
            assert.throws(() => validatePaymentImportInput({ ...base, amountApproximate: "yes" }))
            assert.throws(() => validatePaymentImportInput({ ...base, originalAmount: -1 }))
            assert.throws(() => validatePaymentImportInput({ ...base, originalAmount: "9.99" }))
            assert.throws(() => validatePaymentImportInput({ ...base, originalCurrency: "US" }))
            assert.throws(() => validatePaymentImportInput({ ...base, amountNote: "x".repeat(192) }))
        })

        it("概算は分類が決まっても自動登録せず、確定までにとどめる", () => {
            const input = { amount: 1500, date: "2026-09-14", place: "Apple", name: "Apple", confidence: 0.95 }
            const decision = decidePaymentImport(input, rule, true)
            assert.equal(decision.status, "confirmed")
            assert.equal(decision.ledgerCategoryId, 2)
            // 分類が決まらなければ、概算でも従来どおり確認待ち
            assert.equal(decidePaymentImport(input, null, true).status, "pendingReview")
        })
    })

    describe("確認待ちの指定と品目ごとの明細（Issue #1216）", () => {
        const base = { source: "gmail", gmailMessageId: "m1", date: "2026-08-30", amount: 1490, place: "Netflix", name: "Netflix" }

        it("review: true は分類・信頼度が高くても確認待ちで止める", () => {
            const input = validatePaymentImportInput({ ...base, review: true, confidence: 0.95 })
            assert.equal(input.review, true)
            const decision = decidePaymentImport(input, rule)
            assert.equal(decision.status, "pendingReview")
            // 分類履歴に当たったカテゴリは品目へ入れておく（画面で直す前提）
            assert.equal(decision.ledgerCategoryId, 2)
        })

        it("review を渡さなければ従来どおり自動反映する", () => {
            const input = validatePaymentImportInput({ ...base, confidence: 0.95 })
            assert.equal(input.review, false)
            assert.equal(decidePaymentImport(input, rule).status, "imported")
        })

        it("review: true なら place・amount が無くても受け付ける", () => {
            const input = validatePaymentImportInput({ source: "gmail", gmailMessageId: "m1", date: "2026-08-30", name: "メール", review: true })
            assert.equal(input.amount, null)
            assert.equal(input.place, null)
            assert.equal(decidePaymentImport(input, null).status, "pendingReview")
        })

        it("review なしでは place・amount を必須のままにする", () => {
            assert.throws(() => validatePaymentImportInput({ ...base, amount: undefined }))
            assert.throws(() => validatePaymentImportInput({ ...base, place: undefined }))
        })

        it("items があれば name を省略でき、amount を省くと品目の合計になる", () => {
            const input = validatePaymentImportInput({
                source: "gmail",
                gmailMessageId: "m1",
                date: "2026-08-30",
                place: "店",
                items: [{ name: "牛乳", amount: 200, quantity: 2 }, { name: "パン", amount: 150 }],
            })
            assert.equal(input.amount, 350)
            assert.equal(input.name, "牛乳")
            assert.equal(input.items?.length, 2)
            assert.equal(input.items?.[0].quantity, 2)
        })

        it("items の不正な行を断る", () => {
            const make = (items: unknown) => () => validatePaymentImportInput({ ...base, items })
            assert.throws(make([]))
            assert.throws(make("牛乳"))
            assert.throws(make([{ name: "", amount: 100 }]))
            assert.throws(make([{ name: "牛乳", amount: 0 }]))
            assert.throws(make([{ name: "牛乳", amount: 10.5 }]))
            assert.throws(make([{ name: "牛乳", amount: 100, quantity: 0 }]))
        })

        it("品目の合計が合わなければ確認待ちに倒す", () => {
            const input = validatePaymentImportInput({ ...base, confidence: 0.95 })
            const decision = decidePaymentImport(input, rule, false, true)
            assert.equal(decision.status, "pendingReview")
            assert.equal(decision.reason, ITEMS_TOTAL_MISMATCH_REASON)
        })
    })
})

describe("外貨建ての円換算（Issue #1415）", () => {
    const base = validatePaymentImportInput({
        source: "gmail",
        gmailMessageId: "m-usd",
        date: "2026-11-14",
        place: "Anthropic, PBC",
        name: "Claude Max",
        review: true,
        originalAmount: 110,
        originalCurrency: "usd",
    })
    const rate = { rate: 154.1, date: "2026-11-13" }

    it("品目も円の金額も無い外貨建ては、換算した金額と注記を補う（review の有無によらない）", () => {
        const converted = applyYenConversion(base, rate)
        assert.equal(converted.amount, 16951)
        assert.equal(converted.amountNote, "USD 110 を 1ドル=154.1円で換算（2026-11-13のレート）")
        const notReview = applyYenConversion({ ...base, review: false }, rate)
        assert.equal(notReview.amount, 16951)
    })

    it("円の金額がある・品目がある・JPY・元の金額が無い・レートが取れないときは換算しない", () => {
        assert.equal(applyYenConversion({ ...base, amount: 17000 }, rate).amount, 17000)
        const withItems = { ...base, items: [{ name: "Claude Max", amount: 17000 }], amount: null }
        assert.equal(applyYenConversion(withItems, rate).amount, null)
        assert.equal(applyYenConversion({ ...base, originalCurrency: "JPY" }, rate).amount, null)
        assert.equal(applyYenConversion({ ...base, originalAmount: null }, rate).amount, null)
        assert.equal(applyYenConversion(base, null).amount, null)
        assert.equal(needsYenConversion({ amount: null, items: [], originalAmount: 9.99, originalCurrency: "EUR" }), true)
    })

    it("レートの表示は小数2桁まで・USD以外は通貨コードで書く", () => {
        assert.equal(formatRate(160), "160")
        assert.equal(formatRate(154.1234), "154.12")
        assert.equal(describeConversion("EUR", 9.99, { rate: 170.5, date: "" }), "EUR 9.99 を 1EUR=170.5円で換算")
    })
})
