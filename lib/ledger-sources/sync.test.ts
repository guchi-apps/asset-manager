import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { parseZaimTransactions, resolveZaimKind } from "./zaim/adapter"
import {
    buildEntryDraft,
    changedFields,
    detectEditedFields,
    hashSourceRecord,
    isCoveredDate,
    isInfoSourceRecord,
    readEditedFields,
    splitChanges,
    type SourceResolver,
} from "./sync-plan"
import type { SourceRecordInput } from "./types"

const NOW = new Date("2026-11-03T12:00:00+09:00")

describe("parseZaimTransactions", () => {
    const payload = {
        empty: false,
        stale: false,
        fetchedAt: "2026-11-03T11:35:00+09:00",
        months: ["202610", "202611"],
        entries: [
            {
                id: 9000000001,
                date: "2026-11-01",
                amount: 3280,
                category: "食費",
                genre: "食料品",
                account: "テストカード",
                toAccount: "",
                place: "テストスーパー",
                name: "牛乳…",
                comment: "",
                itemsStatus: "complete",
                items: [
                    { id: 9000000001, name: "牛乳", amount: 2880, category: "食費", genre: "食料品" },
                    { id: 9000000002, name: "洗剤", amount: 400, category: "日用雑貨", genre: "消耗品" },
                ],
            },
            {
                id: 9000000003,
                date: "2026-11-02",
                amount: 1000,
                category: "食費",
                genre: "外食",
                account: "テストカード",
                toAccount: "",
                place: "店",
                name: "代表",
                comment: "",
                itemsStatus: "partial",
                items: [{ id: 1, name: "a", amount: 500 }],
            },
            { id: 9000000004, date: "2026-11-02", amount: 300000, category: "給料", genre: "", account: "", toAccount: "テスト銀行", place: "", name: "", comment: "" },
            { id: 9000000005, date: "2026-11-02", amount: 5000, category: "-", genre: "-", account: "テスト銀行", toAccount: "PayPay", place: "", name: "", comment: "" },
            { id: null, date: "2026-11-02", amount: 1, account: "x" },
            { id: 9000000006, date: "bad", amount: 1 },
        ],
    }
    const snapshot = parseZaimTransactions(payload, NOW)

    it("idの無い明細は数えて捨て、日付の読めない明細は落とす", () => {
        assert.equal(snapshot.records.length, 4)
        assert.equal(snapshot.skippedNoId, 1)
        assert.deepEqual(snapshot.coveredMonths, ["202610", "202611"])
    })

    it("内訳は complete で合計が合うときだけ使う", () => {
        assert.equal(snapshot.records[0].items?.length, 2)
        assert.equal(snapshot.records[1].items, null)
        assert.equal(snapshot.records[1].itemsStatus, "partial")
    })

    it("種別を口座の有無から推定する", () => {
        assert.deepEqual(
            snapshot.records.map((r) => [r.kind, r.kindInferred, r.fromName, r.toName]),
            [
                ["EXPENSE", true, "テストカード", null],
                ["EXPENSE", true, "テストカード", null],
                ["INCOME", true, null, "テスト銀行"],
                ["TRANSFER", true, "テスト銀行", "PayPay"],
            ]
        )
        assert.equal(snapshot.records[3].category, null)
    })

    it("AIDEが種別を返せばそれを使う", () => {
        assert.deepEqual(resolveZaimKind("income", "a", "b"), { kind: "INCOME", inferred: false })
        assert.deepEqual(resolveZaimKind(undefined, "a", null), { kind: "EXPENSE", inferred: true })
    })

    it("月を返さない古いAIDEは巡回した月だけを読めたものとする", () => {
        const old = parseZaimTransactions({ ...payload, months: undefined }, NOW)
        assert.deepEqual(old.coveredMonths, ["202611"])
        assert.deepEqual(parseZaimTransactions({ empty: true, entries: [] }, NOW).coveredMonths, [])
    })
})

const record = (overrides: Partial<SourceRecordInput> = {}): SourceRecordInput => ({
    externalId: "1",
    date: "2026-11-01",
    amount: 1000,
    kind: "EXPENSE",
    kindInferred: true,
    fromName: "テストカード",
    toName: null,
    place: "店",
    name: "品",
    memo: null,
    category: "食費",
    genre: "外食",
    items: null,
    itemsStatus: null,
    excluded: null,
    ...overrides,
})

const resolver: SourceResolver = {
    account: (name) =>
        name === "スマートレシート"
            ? { accountId: null, infoSource: true }
            : name === "テストカード"
              ? { accountId: 7, infoSource: false }
              : { accountId: null, infoSource: false },
    category: (category, genre, kind) => (kind === "EXPENSE" && category === "食費" ? (genre === "外食" ? 3 : 1) : null),
}

describe("changedFields / splitChanges", () => {
    it("同じ中身ならハッシュも変わらない（キーの順に依らない）", () => {
        const a = record()
        const b = Object.fromEntries(Object.entries(record()).reverse()) as SourceRecordInput
        assert.equal(hashSourceRecord(a), hashSourceRecord(b))
    })

    it("金額が変われば品目も作り直す", () => {
        assert.deepEqual(changedFields(record(), record({ amount: 1200 })), ["amount", "lines"])
        assert.deepEqual(changedFields(record(), record({ genre: "食料品" })), ["lines"])
        assert.deepEqual(changedFields(record(), record({ memo: "x", fromName: "別" })), ["accounts", "memo"])
    })

    it("手直しした項目はぶつかりとして分ける", () => {
        assert.deepEqual(splitChanges(["amount", "lines", "memo"], ["lines"]), { apply: ["amount", "memo"], conflicts: ["lines"] })
    })
})

describe("buildEntryDraft", () => {
    it("対応表で口座とカテゴリを引き、取り込み元の分類名を残す", () => {
        const draft = buildEntryDraft(record(), resolver)
        assert.equal(draft.fromAccountId, 7)
        assert.deepEqual(draft.lines, [
            { name: "品", amount: 1000, categoryId: 3, sourceCategoryName: "食費", sourceGenreName: "外食", classifiedBy: "SOURCE" },
        ])
    })

    it("内訳があれば品目ごとに作る", () => {
        const draft = buildEntryDraft(
            record({
                items: [
                    { name: "a", amount: 600, category: "食費", genre: "飲料" },
                    { name: "b", amount: 400, category: "日用", genre: null },
                ],
            }),
            resolver
        )
        assert.deepEqual(
            draft.lines.map((l) => [l.name, l.amount, l.categoryId, l.classifiedBy]),
            [
                ["a", 600, 1, "SOURCE"],
                ["b", 400, null, null],
            ]
        )
    })

    it("集計に含めない・振替", () => {
        assert.equal(buildEntryDraft(record({ excluded: true }), resolver).excludeFromTotals, true)
        const transfer = buildEntryDraft(record({ kind: "TRANSFER", toName: "PayPay", category: null, genre: null }), resolver)
        assert.deepEqual(transfer.lines, [])
        assert.equal(transfer.sourceToName, "PayPay")
    })

    it("情報源の口座の明細は取引にしない", () => {
        assert.equal(isInfoSourceRecord(record({ fromName: "スマートレシート" }), resolver), true)
        assert.equal(isInfoSourceRecord(record(), resolver), false)
    })
})

describe("isCoveredDate", () => {
    it("全日を読めた月だけ", () => {
        assert.equal(isCoveredDate("2026-10-31", ["202610", "202611"]), true)
        assert.equal(isCoveredDate("2026-09-30", ["202610", "202611"]), false)
    })
})

describe("detectEditedFields", () => {
    const base = {
        kind: "EXPENSE",
        status: "CONFIRMED",
        date: "2026-11-01",
        amount: 1000,
        fromAccountId: 7,
        toAccountId: null,
        place: "店",
        memo: null,
        excludeFromTotals: false,
        lines: [{ name: "品", amount: 1000, categoryId: 3 }],
    }
    it("変えた項目だけを返す", () => {
        assert.deepEqual(detectEditedFields(base, base), [])
        assert.deepEqual(
            detectEditedFields(base, { ...base, memo: "メモ", lines: [{ name: "品", amount: 1000, categoryId: 1 }] }),
            ["memo", "lines"]
        )
    })
    it("保存済みの記録は知らない値を捨てて読む", () => {
        assert.deepEqual(readEditedFields(["memo", "x", 1]), ["memo"])
        assert.deepEqual(readEditedFields(null), [])
    })
})
