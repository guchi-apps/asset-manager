import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { parseZaimTransactions, resolveZaimKind, zaimCalcFlagExcluded } from "./zaim/adapter"
import {
    buildEntryDraft,
    changedFields,
    chunkIds,
    coveredDateRange,
    detectEditedFields,
    hashSourceRecord,
    isCoveredDate,
    isInfoSourceRecord,
    isTransferInRecord,
    pickDraftsCoveredBySource,
    pickLateArrivals,
    pickMergedIntoTransfer,
    pickMissingRecords,
    readEditedFields,
    splitChanges,
    unchangedTouchOf,
    type CsvEntryFacet,
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

    it("集計の設定（calcFlag）を「集計に含めない」へ直す。0=含めない、10=含める、3=年のみ（含める）", () => {
        assert.equal(zaimCalcFlagExcluded(0), true)
        assert.equal(zaimCalcFlagExcluded(10), false)
        assert.equal(zaimCalcFlagExcluded(3), false)
        assert.equal(zaimCalcFlagExcluded(7), null)
        assert.equal(zaimCalcFlagExcluded(undefined), null)
        const parsed = parseZaimTransactions({ ...payload, entries: [{ ...payload.entries[0], calcFlag: 0 }] }, NOW)
        assert.equal(parsed.records[0].excluded, true)
        assert.equal(buildEntryDraft(parsed.records[0], resolver).excludeFromTotals, true)
    })

    it("「年の集計にのみ含める」（calcFlag 3）は特別な支出の印にし、それ以外の明細にはキーを足さない（#835）", () => {
        const yearOnly = parseZaimTransactions({ ...payload, entries: [{ ...payload.entries[0], calcFlag: 3 }] }, NOW)
        assert.equal(yearOnly.records[0].special, true)
        assert.equal(yearOnly.records[0].excluded, false)
        assert.equal(buildEntryDraft(yearOnly.records[0], resolver).special, true)
        const always = parseZaimTransactions({ ...payload, entries: [{ ...payload.entries[0], calcFlag: 10 }] }, NOW)
        assert.equal("special" in always.records[0], false)
        assert.equal(buildEntryDraft(always.records[0], resolver).special, false)
    })

    it("集計の設定の生の値は、AIDEが返したときだけ残す（返さない明細のハッシュは変えない）", () => {
        const withFlag = parseZaimTransactions({ ...payload, entries: [{ ...payload.entries[0], mode: "payment", calcFlag: 10 }] }, NOW)
        assert.equal(withFlag.records[0].calcFlag, 10)
        assert.equal(withFlag.records[0].kindInferred, false)
        assert.equal("calcFlag" in snapshot.records[0], false)
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
    // Zaimの分類から引く（CSV移行と同じ）。継続取り込みの分類の順番は ledger-rules.test.ts で確かめる
    classify: ({ kind, category, genre }) => {
        const categoryId = kind === "EXPENSE" && category === "食費" ? (genre === "外食" ? 3 : 1) : null
        return { categoryId, classifiedBy: categoryId != null ? "SOURCE" : null }
    },
    transferIn: ({ place }) => place === "自動入金",
    transferTo: ({ place }) => (place === "テスト証券積立" ? 50 : null),
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

    it("振替にする支出は、入金先の口座への振替にして集計の除外を外す（#822）", () => {
        const draft = buildEntryDraft(record({ place: "テスト証券積立", excluded: true }), resolver)
        assert.deepEqual(
            [draft.kind, draft.fromAccountId, draft.toAccountId, draft.excludeFromTotals, draft.lines.length, draft.sourceFromName],
            ["TRANSFER", 7, 50, false, 0, "テストカード"]
        )
        assert.equal(buildEntryDraft(record({ place: "テスト証券積立", kind: "INCOME", fromName: null, toName: "銀行" }), resolver).kind, "INCOME")
    })

    it("振替の受け側にした収入は取引にしない（支出には当てない）", () => {
        assert.equal(isTransferInRecord(record({ kind: "INCOME", place: "自動入金", fromName: null, toName: "銀行" }), resolver), true)
        assert.equal(isTransferInRecord(record({ kind: "EXPENSE", place: "自動入金" }), resolver), false)
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

describe("変化の無い明細の一括更新（#1090）", () => {
    it("有効・要確認のままの記録は、状態を変えずに見た時刻だけ進める", () => {
        assert.equal(unchangedTouchOf({ state: "ACTIVE", pendingFields: null }), "seen")
        assert.equal(unchangedTouchOf({ state: "CHANGED", pendingFields: ["memo"] }), "seen")
    })

    it("見当たらない・確認済みから戻った記録は、確認待ちの項目が残っていれば要確認、無ければ有効へ戻す", () => {
        assert.equal(unchangedTouchOf({ state: "MISSING", pendingFields: null }), "toActive")
        assert.equal(unchangedTouchOf({ state: "DISMISSED", pendingFields: null }), "toActive")
        assert.equal(unchangedTouchOf({ state: "MISSING", pendingFields: ["lines"] }), "toChanged")
    })

    it("id を指定した件数ずつに分ける（空なら問い合わせない）", () => {
        assert.deepEqual(chunkIds([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
        assert.deepEqual(chunkIds([], 2), [])
        assert.equal(chunkIds(Array.from({ length: 2500 }, (_, i) => i)).length, 3)
    })

    it("見当たらないのは、全日を読めた月にあって今回の応答に無い記録だけ", () => {
        const rows = [
            { id: 1, externalId: "a", date: "2026-10-05" },
            { id: 2, externalId: "b", date: "2026-10-06" },
            { id: 3, externalId: "c", date: "2026-09-30" },
        ]
        assert.deepEqual(
            pickMissingRecords(rows, new Set(["a"]), ["202610", "202611"]).map((r) => r.id),
            [2]
        )
    })

    it("見当たらないの候補を読む範囲は、全日を読めた月の初日から末日まで", () => {
        assert.deepEqual(coveredDateRange(["202611", "202610"]), { from: "2026-10-01", to: "2026-11-31" })
        assert.equal(coveredDateRange([]), null)
        // 範囲の末尾は文字列の比較で月末の日をすべて含む
        assert.ok("2026-11-30" <= coveredDateRange(["202611"])!.to)
        assert.ok("2026-12-01" > coveredDateRange(["202611"])!.to)
    })
})

describe("pickMergedIntoTransfer（振替に統合された明細。#1379）", () => {
    const accounts: Pick<SourceResolver, "account"> = {
        account: (name) => ({ accountId: ({ ICOCA: 10, "J-WESTカード": 20 } as Record<string, number>)[name ?? ""] ?? null, infoSource: false }),
    }
    const before = new Date("2026-11-14T11:52:00+09:00")
    const after = new Date("2026-11-14T12:05:00+09:00")
    const charge = {
        id: 1,
        date: "2026-11-09",
        amount: 10000,
        lastSeenAt: before,
        payload: record({ externalId: "c", kind: "INCOME", fromName: null, toName: "ICOCA", date: "2026-11-09", amount: 10000 }),
    }
    const transfer = {
        id: 2,
        date: "2026-11-09",
        amount: 10000,
        firstSeenAt: after,
        payload: record({ externalId: "t", kind: "TRANSFER", fromName: "J-WESTカード", toName: "ICOCA", date: "2026-11-09", amount: 10000 }),
    }

    it("見当たらなくなったチャージ（収入）を、あとから届いた同額・同じ入金先の振替と組にする", () => {
        assert.deepEqual(
            pickMergedIntoTransfer([charge], [transfer], accounts).map((p) => [p.missing.id, p.transfer.id]),
            [[1, 2]]
        )
    })

    it("カードの利用（支出）は出金元の口座で組にする", () => {
        const card = { ...charge, id: 3, payload: record({ kind: "EXPENSE", fromName: "J-WESTカード", amount: 10000 }) }
        assert.equal(pickMergedIntoTransfer([charge, card], [transfer], accounts).length, 2)
    })

    it("金額・口座・日付のずれ・届いた順のどれかが合わなければ組にしない", () => {
        const cases = [
            { ...transfer, amount: 9000 },
            { ...transfer, payload: record({ kind: "TRANSFER", fromName: "J-WESTカード", toName: "別の口座" }) },
            { ...transfer, date: "2026-11-13" },
            // 振替が収入より前から取り込み元にあった（同時にあったので統合ではない）
            { ...transfer, firstSeenAt: new Date("2026-11-01T00:00:00+09:00") },
        ]
        for (const t of cases) assert.deepEqual(pickMergedIntoTransfer([charge], [t], accounts), [])
        assert.equal(pickMergedIntoTransfer([charge], [{ ...transfer, date: "2026-11-12" }], accounts).length, 1)
    })

    it("候補の振替が複数・同じ振替へ同じ側の明細が複数当たるときは決めない", () => {
        assert.deepEqual(pickMergedIntoTransfer([charge], [transfer, { ...transfer, id: 4 }], accounts), [])
        assert.deepEqual(pickMergedIntoTransfer([charge, { ...charge, id: 5 }], [transfer], accounts), [])
    })

    it("振替そのものや口座を引けない明細は対象にしない", () => {
        const gone = [
            { ...charge, payload: record({ kind: "TRANSFER", fromName: "J-WESTカード", toName: "ICOCA", amount: 10000 }) },
            { ...charge, payload: record({ kind: "INCOME", fromName: null, toName: "不明", amount: 10000 }) },
        ]
        assert.deepEqual(pickMergedIntoTransfer(gone, [transfer], accounts), [])
    })
})

describe("pickLateArrivals（取り込み開始日より前に遅れて届いた明細。#1347）", () => {
    const transfer = (externalId: string, date: string, amount: number) =>
        record({ externalId, date, amount, kind: "TRANSFER", fromName: "テストカード", toName: "ETC 利用照会", place: null, name: null, category: null, genre: null, excluded: true })
    const csvTransfer = (date: string, amount: number): CsvEntryFacet => ({
        kind: "TRANSFER",
        date,
        amount,
        sourceFromName: "テストカード",
        sourceToName: "ETC 利用照会",
    })
    const ids = (records: SourceRecordInput[]) => records.map((r) => r.externalId)

    it("CSVに対応が無く、照合できた明細より新しいものだけを選ぶ", () => {
        const records = [transfer("100", "2026-10-14", 1310), transfer("101", "2026-10-15", 1310), transfer("200", "2026-10-17", 620)]
        const csv = [csvTransfer("2026-10-14", 1310), csvTransfer("2026-10-15", 1310)]
        assert.deepEqual(ids(pickLateArrivals(records, csv, resolver)), ["200"])
    })

    it("照合できた明細より古いものは、CSVに対応が無くても選ばない（CSVを書き出した時点で取り込み元にあった）", () => {
        const records = [transfer("90", "2026-10-10", 960), transfer("100", "2026-10-14", 1310), transfer("200", "2026-10-17", 620)]
        const csv = [csvTransfer("2026-10-14", 1310)]
        assert.deepEqual(ids(pickLateArrivals(records, csv, resolver)), ["200"])
    })

    it("同じ日・同じ金額が2件あれば、CSVの件数ぶんだけ対応させる", () => {
        const records = [transfer("100", "2026-10-17", 620), transfer("201", "2026-10-17", 620)]
        assert.deepEqual(ids(pickLateArrivals(records, [csvTransfer("2026-10-17", 620)], resolver)), ["201"])
        assert.deepEqual(ids(pickLateArrivals(records, [csvTransfer("2026-10-17", 620), csvTransfer("2026-10-17", 620)], resolver)), [])
    })

    it("口座名は末尾の括弧書き・空白の揺れを無視して比べる", () => {
        const records = [transfer("100", "2026-10-14", 1310), transfer("200", "2026-10-17", 620)]
        const csv = [{ ...csvTransfer("2026-10-14", 1310), sourceFromName: "テストカード(自動連携)", sourceToName: "ETC利用照会" }]
        assert.deepEqual(ids(pickLateArrivals(records, csv, resolver)), ["200"])
    })

    it("CSVで1件にまとまる同じ日・同じお店の支出は、合計で照合する", () => {
        const records = [
            record({ externalId: "100", date: "2026-10-14", amount: 300, place: "テストスーパー", memo: null }),
            record({ externalId: "101", date: "2026-10-14", amount: 700, place: "テストスーパー", memo: null }),
            transfer("200", "2026-10-17", 620),
        ]
        const csv: CsvEntryFacet[] = [{ kind: "EXPENSE", date: "2026-10-14", amount: 1000, sourceFromName: "テストカード", sourceToName: null }]
        assert.deepEqual(ids(pickLateArrivals(records, csv, resolver)), ["200"])
    })

    it("分類ルールで振替にする支出は、CSVと同じく入金先の口座名なしの振替として照合する", () => {
        const records = [record({ externalId: "100", date: "2026-10-14", amount: 30000, place: "テスト証券積立" }), transfer("200", "2026-10-17", 620)]
        const csv: CsvEntryFacet[] = [{ kind: "TRANSFER", date: "2026-10-14", amount: 30000, sourceFromName: "テストカード", sourceToName: null }]
        assert.deepEqual(ids(pickLateArrivals(records, csv, resolver)), ["200"])
    })

    it("情報源の口座・振替の受け側の収入は選ばない", () => {
        const records = [
            transfer("100", "2026-10-14", 1310),
            record({ externalId: "200", date: "2026-10-17", fromName: "スマートレシート" }),
            record({ externalId: "201", date: "2026-10-17", kind: "INCOME", fromName: null, toName: "テストカード", place: "自動入金" }),
        ]
        assert.deepEqual(ids(pickLateArrivals(records, [csvTransfer("2026-10-14", 1310)], resolver)), [])
    })

    it("CSVの取引が無い・1件も照合できないときは境を決められないので選ばない", () => {
        const records = [transfer("200", "2026-10-17", 620)]
        assert.deepEqual(pickLateArrivals(records, [], resolver), [])
        assert.deepEqual(pickLateArrivals(records, [csvTransfer("2026-10-01", 999)], resolver), [])
    })
})

describe("pickDraftsCoveredBySource（遅着明細のあとの更新版CSV。#1364）", () => {
    const draft = (key: string, over: Record<string, unknown> = {}) => ({
        key,
        kind: "EXPENSE",
        date: "2026-03-10",
        amount: 500,
        fromName: "財布",
        toName: null,
        place: "コンビニ",
        memo: null,
        excluded: false,
        special: false,
        ...over,
    })
    const source = (over: Record<string, unknown> = {}) => ({
        kind: "EXPENSE",
        date: "2026-03-10",
        amount: 500,
        sourceFromName: "財布",
        sourceToName: null,
        place: "コンビニ",
        memo: null,
        excludeFromTotals: false,
        special: false,
        ...over,
    })

    it("同じ内容の取り込み元の取引があるCSV行は除く", () => {
        const covered = pickDraftsCoveredBySource([draft("a"), draft("b", { amount: 800 })], [source()])
        assert.deepEqual([...covered], ["a"])
    })

    it("取り込み元に無い行・別の口座の行は除かない", () => {
        assert.equal(pickDraftsCoveredBySource([draft("a", { fromName: "銀行" })], [source()]).size, 0)
        assert.equal(pickDraftsCoveredBySource([draft("a")], []).size, 0)
    })

    it("CSVに同じ内容が2件あっても、取り込み元の件数（1件）ぶんだけ除く", () => {
        const covered = pickDraftsCoveredBySource([draft("a"), draft("b")], [source()])
        assert.equal(covered.size, 1)
    })

    it("CSVで1件にまとまる支出は、取り込み元の2件以上の合計と照合する", () => {
        const covered = pickDraftsCoveredBySource([draft("a", { amount: 800 })], [source({ amount: 300 }), source({ amount: 500 })])
        assert.deepEqual([...covered], ["a"])
        assert.equal(pickDraftsCoveredBySource([draft("a", { amount: 900 })], [source({ amount: 300 }), source({ amount: 500 })]).size, 0)
    })

    it("振替は出金元と日付・金額で照合する", () => {
        const covered = pickDraftsCoveredBySource(
            [draft("t", { kind: "TRANSFER", place: null, toName: null })],
            [source({ kind: "TRANSFER", place: null })]
        )
        assert.deepEqual([...covered], ["t"])
    })

    it("収入は入金先で照合する", () => {
        const covered = pickDraftsCoveredBySource(
            [draft("i", { kind: "INCOME", fromName: null, toName: "銀行", place: null })],
            [source({ kind: "INCOME", sourceFromName: null, sourceToName: "銀行", place: null })]
        )
        assert.deepEqual([...covered], ["i"])
    })

    it("素の振替は出金元と入金先の両方で照合し、入金先が違えば除かない", () => {
        const base = { kind: "TRANSFER", place: null }
        const hit = pickDraftsCoveredBySource([draft("t", { ...base, toName: "銀行" })], [source({ ...base, sourceToName: "銀行" })])
        assert.deepEqual([...hit], ["t"])
        const miss = pickDraftsCoveredBySource([draft("t", { ...base, toName: "銀行" })], [source({ ...base, sourceToName: "証券" })])
        assert.equal(miss.size, 0)
    })

    it("全角・半角の違う口座名でも照合する", () => {
        const covered = pickDraftsCoveredBySource([draft("a", { fromName: "ＰａｙＰａｙ" })], [source({ sourceFromName: "PayPay" })])
        assert.deepEqual([...covered], ["a"])
    })

    it("合計の照合は、お店・集計の設定・メモが違えば除かない", () => {
        const two = [source({ amount: 300 }), source({ amount: 500 })]
        assert.equal(pickDraftsCoveredBySource([draft("a", { amount: 800, place: "書店" })], two).size, 0)
        assert.equal(pickDraftsCoveredBySource([draft("a", { amount: 800, excluded: true })], two).size, 0)
        assert.equal(pickDraftsCoveredBySource([draft("a", { amount: 800, memo: "メモ" })], two).size, 0)
    })

    it("合計の照合は、同じ組を2件のCSV行で使い回さない", () => {
        const two = [source({ amount: 300 }), source({ amount: 500 })]
        const covered = pickDraftsCoveredBySource([draft("a", { amount: 800 }), draft("b", { amount: 800 })], two)
        assert.equal(covered.size, 1)
    })

    it("単独の照合で使った取引は、合計の照合に使わない", () => {
        // 500円のCSV行が先に500円の取引を使うので、300+500の合計（800円）は成り立たない
        const covered = pickDraftsCoveredBySource(
            [draft("a"), draft("b", { amount: 800 })],
            [source({ amount: 300 }), source({ amount: 500 })]
        )
        assert.deepEqual([...covered], ["a"])
    })
})
