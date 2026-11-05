import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
    chooseLedgerAccount,
    decidePaymentImport,
    describeAmountNote,
    isApproximateAmount,
    LEDGER_ACCOUNT_UNRESOLVED_REASON,
    validatePaymentImportInput,
} from "@/lib/payment-import"

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
        assert.equal(decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.95 }, rule, true).status, "imported")
    })

    it("分類が不明・信頼度が低いなら確認待ちにする", () => {
        assert.equal(decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.95 }, null, true).status, "pendingReview")
        assert.equal(decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.5 }, rule, true).status, "pendingReview")
    })

    it("家計簿の口座が決まらなければ確定までにとどめる（Issue #823）", () => {
        const decision = decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.95 }, rule, false)
        assert.equal(decision.status, "confirmed")
        assert.equal(decision.reason, LEDGER_ACCOUNT_UNRESOLVED_REASON)
        assert.equal(decision.ledgerCategoryId, 2)
        assert.equal(decision.genreName, "インターネット接続料")
    })

    it("家計簿のカテゴリへ移せなかった旧い規則は、規則が無いのと同じに扱う（Issue #843）", () => {
        const legacy = { ...rule, ledgerCategoryId: null }
        const decision = decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.95 }, legacy, true)
        assert.equal(decision.status, "pendingReview")
        assert.equal(decision.ledgerCategoryId, null)
        assert.equal(decision.categoryName, null)
    })

    it("信頼度が低いときも、規則のカテゴリは下書きとして残す", () => {
        const decision = decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.5 }, rule, true)
        assert.equal(decision.status, "pendingReview")
        assert.equal(decision.ledgerCategoryId, 2)
    })

    it("中分類を持たない大分類の規則は、中分類名を null にする", () => {
        const decision = decidePaymentImport({ amount: 1490, date: "2026-08-30", place: "Netflix", name: "Netflix", confidence: 0.95 }, { ...rule, genreName: "" }, true)
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
            const decision = decidePaymentImport(input, rule, true, true)
            assert.equal(decision.status, "confirmed")
            assert.equal(decision.ledgerCategoryId, 2)
            // 分類が決まらなければ、概算でも従来どおり確認待ち
            assert.equal(decidePaymentImport(input, null, true, true).status, "pendingReview")
        })
    })
})

describe("chooseLedgerAccount（既定のカードの解決順。#843）", () => {
    const lookups = (over: {
        byName?: Record<string, number>
        configured?: { configured: boolean; accountId: number | null }
        migrated?: number | null
    }) => {
        const calls: string[] = []
        return {
            calls,
            lookups: {
                byName: async (name: string) => {
                    calls.push("byName:" + name)
                    return over.byName?.[name] ?? null
                },
                configuredDefault: async () => {
                    calls.push("configured")
                    return over.configured ?? { configured: false, accountId: null }
                },
                migrateFromZaim: async () => {
                    calls.push("migrate")
                    return over.migrated ?? null
                },
            },
        }
    }

    it("支払方法で口座を名指しできればそれを使い、設定も引き継ぎも読まない", async () => {
        const { calls, lookups: l } = lookups({ byName: { "楽天カード": 3 }, configured: { configured: true, accountId: 9 } })
        assert.equal(await chooseLedgerAccount("楽天カード", l), 3)
        assert.deepEqual(calls, ["byName:楽天カード"])
    })

    it("名指しで決まらなければ既定のカードの設定を使い、引き継ぎは呼ばない", async () => {
        const { calls, lookups: l } = lookups({ configured: { configured: true, accountId: 9 }, migrated: 5 })
        assert.equal(await chooseLedgerAccount("知らないカード", l), 9)
        assert.deepEqual(calls, ["byName:知らないカード", "configured"])
    })

    it("設定済みの口座が見つからなければ null（環境変数の引き継ぎへ戻らない）", async () => {
        const { calls, lookups: l } = lookups({ configured: { configured: true, accountId: null }, migrated: 5 })
        assert.equal(await chooseLedgerAccount(null, l), null)
        assert.deepEqual(calls, ["configured"])
    })

    it("未設定のときだけ、環境変数からの引き継ぎを使う", async () => {
        const { calls, lookups: l } = lookups({ migrated: 5 })
        assert.equal(await chooseLedgerAccount(undefined, l), 5)
        assert.deepEqual(calls, ["configured", "migrate"])
    })

    it("どれでも決まらなければ null", async () => {
        const { lookups: l } = lookups({})
        assert.equal(await chooseLedgerAccount("x", l), null)
    })
})
