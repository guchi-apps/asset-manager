import { test } from "node:test"
import assert from "node:assert/strict"

import { expandSpread } from "@/lib/ledger-spread"
import { computeSpendPace, dailyExpense, dailyExpenseItems, daysBetween, typicalSavings } from "@/lib/ledger-pace"
import { summarizeLedger } from "@/lib/ledger-summary"
import type { LedgerPeriod } from "@/lib/ledger-period"
import type { DatedSummaryEntry } from "@/lib/ledger-trend"

const p = (start: string, end: string): LedgerPeriod => ({ start, end, label: start })
const exp = (date: string, amount: number, extra: Partial<DatedSummaryEntry> = {}): DatedSummaryEntry => ({
    date,
    kind: "EXPENSE",
    status: "CONFIRMED",
    amount,
    excludeFromTotals: false,
    toAccountId: null,
    toAccountKind: null,
    lines: [],
    ...extra,
})

// 10日ずつの3期間。毎期間、1日目に家賃10000、残りは毎日1000
const periods = [p("2026-08-01", "2026-08-10"), p("2026-09-01", "2026-09-10"), p("2026-10-01", "2026-10-10")]
const monthly = (start: string): DatedSummaryEntry[] => {
    const month = start.slice(0, 8)
    return [exp(`${month}01`, 10000), ...Array.from({ length: 9 }, (_, i) => exp(`${month}${String(i + 2).padStart(2, "0")}`, 1000))]
}
const history = [...monthly("2026-08-01"), ...monthly("2026-09-01")]

test("daysBetween は月をまたいでも日数を数える", () => {
    assert.equal(daysBetween("2026-10-30", "2026-11-02"), 3)
})

test("最初の数日は見込みを出さず、残り日数を返す", () => {
    const pace = computeSpendPace(periods, [...history, exp("2026-10-01", 10000)], "2026-10-02")
    assert.equal(pace.forecast, null)
    assert.equal(pace.forecastBlockedBy, "days")
    assert.equal(pace.daysUntilForecast, 3)
})

test("月初の固定費を日割りにせず、過去の比率から着地を出す", () => {
    const entries = [...history, ...monthly("2026-10-01").slice(0, 5)]
    const pace = computeSpendPace(periods, entries, "2026-10-05")
    // 5日目までに 10000+4000=14000。過去は5日目までに全体19000のうち14000 → 14000/(14000/19000)=19000
    assert.equal(pace.forecast?.landing, 19000)
    assert.equal(pace.forecast?.band, 0)
})

test("特別な支出はペースから外し、実績を足す", () => {
    const entries = [...history, ...monthly("2026-10-01").slice(0, 5), exp("2026-10-03", 50000, { special: true })]
    const pace = computeSpendPace(periods, entries, "2026-10-05")
    assert.equal(pace.forecast?.landing, 69000)
})

test("過去の期間が足りなければ見込みを出さない", () => {
    const pace = computeSpendPace(periods, [...monthly("2026-09-01"), ...monthly("2026-10-01")], "2026-10-06")
    assert.equal(pace.forecastBlockedBy, "history")
})

test("取引が0件でも崩れない", () => {
    const pace = computeSpendPace(periods, [], "2026-10-07")
    assert.equal(pace.forecast, null)
    assert.deepEqual(pace.actual, [0, 0, 0, 0, 0, 0, 0])
})

test("累計の最終値が summarizeLedger の支出と一致する", () => {
    const entries = [
        ...monthly("2026-10-01"),
        exp("2026-10-04", 777, { status: "PENDING_STATEMENT" }),
        exp("2026-10-05", 5000, { excludeFromTotals: true }),
        exp("2026-10-06", 3000, { status: "MATCH_PENDING" }),
        exp("2026-10-07", 20000, { special: true }),
    ]
    const pace = computeSpendPace(periods, entries, "2026-10-20")
    assert.equal(pace.actual.length, 10)
    assert.equal(pace.inProgress, false)
    assert.equal(pace.actual[9], summarizeLedger(entries, []).expense)
})

test("日ごとの支出・うち特別を今日の分まで返し、証券口座への振替は含めない（#916・#968）", () => {
    const entries = [
        exp("2026-10-01", 3000),
        exp("2026-10-02", 5000, { special: true }),
        exp("2026-10-02", 1000),
        exp("2026-10-03", 9999, { status: "MATCH_PENDING" }),
        exp("2026-10-01", 100000, { kind: "TRANSFER", toAccountKind: "SECURITIES" }),
        exp("2026-10-02", 20000, { kind: "TRANSFER", toAccountKind: "BANK" }),
        exp("2026-10-03", 30000, { kind: "TRANSFER", toAccountKind: "SECURITIES", excludeFromTotals: true }),
        exp("2026-10-05", 50000, { kind: "TRANSFER", toAccountKind: "SECURITIES" }),
    ]
    const pace = computeSpendPace(periods, entries, "2026-10-03")
    assert.deepEqual(pace.daily, [3000, 6000, 0])
    assert.deepEqual(pace.dailySpecial, [0, 5000, 0])
    assert.deepEqual(pace.actual, [3000, 9000, 9000])
})

test("まだ始まっていない期間は日ごとの値も空", () => {
    const pace = computeSpendPace(periods, [exp("2026-10-01", 1000)], "2026-09-20")
    assert.deepEqual(pace.daily, [])
    assert.deepEqual(pace.dailySpecial, [])
})

const toSecurities = (date: string, amount: number, extra: Partial<DatedSummaryEntry> = {}): DatedSummaryEntry => ({
    date,
    kind: "TRANSFER",
    status: "CONFIRMED",
    amount,
    excludeFromTotals: false,
    toAccountId: 9,
    toAccountKind: "SECURITIES",
    lines: [],
    ...extra,
})

test("貯蓄・投資の目安は、振替があった過去の期間の平均（#1014）", () => {
    const past = [p("2026-08-01", "2026-08-10"), p("2026-09-01", "2026-09-10"), p("2026-10-01", "2026-10-10")]
    assert.equal(typicalSavings(past, []), null)
    const one = typicalSavings(past, [toSecurities("2026-09-05", 100000)])
    assert.deepEqual(one, { amount: 100000, periods: 1 })
    const two = typicalSavings(past, [toSecurities("2026-08-05", 100000), toSecurities("2026-10-05", 50000), toSecurities("2026-10-06", 50000)])
    assert.deepEqual(two, { amount: 100000, periods: 2 })
})

test("貯蓄・投資の目安は、証券以外・集計外・照合待ちの振替と3期間より前を数えない", () => {
    const past = [p("2026-07-01", "2026-07-10"), p("2026-08-01", "2026-08-10"), p("2026-09-01", "2026-09-10"), p("2026-10-01", "2026-10-10")]
    const entries = [
        toSecurities("2026-07-05", 900000),
        toSecurities("2026-08-05", 30000, { toAccountKind: null }),
        toSecurities("2026-09-05", 30000, { excludeFromTotals: true }),
        toSecurities("2026-10-05", 30000, { status: "MATCH_PENDING" }),
    ]
    assert.equal(typicalSavings(past, entries), null)
})

test("貯蓄・投資の目安は、進行中の期間だけ持つ", () => {
    const entries = [toSecurities("2026-09-05", 100000)]
    assert.deepEqual(computeSpendPace(periods, entries, "2026-10-02").savingsEstimate, { amount: 100000, periods: 1 })
    assert.equal(computeSpendPace(periods, entries, "2026-11-20").savingsEstimate, null)
    assert.equal(computeSpendPace(periods, entries, "2026-09-20").savingsEstimate, null)
})

test("日別の支出明細は日別の棒と同じ数え方で、合計が一致する", () => {
    const period = p("2026-10-01", "2026-10-03")
    const entries = [
        { ...exp("2026-10-01", 1000), id: 1, place: "コンビニ", lines: [{ amount: 1000, categoryId: 5 }] },
        { ...exp("2026-10-01", 500), id: 2, memo: "  メモ  " },
        { ...exp("2026-10-01", 300, { status: "MATCH_PENDING" }), id: 3 },
        { ...exp("2026-10-02", 400, { excludeFromTotals: true }), id: 4 },
        { ...exp("2026-10-02", 900, { advanceTotal: 900 }), id: 5 },
        { ...exp("2026-10-04", 700), id: 6 },
        { ...exp("2026-10-03", 200, { kind: "INCOME" }), id: 7 },
    ]
    const items = dailyExpenseItems(period, entries)
    assert.deepEqual(Object.keys(items), ["2026-10-01"])
    assert.deepEqual(items["2026-10-01"], [
        { id: 1, label: "コンビニ", categoryId: 5, amount: 1000, work: false, spreadSourceDate: null },
        { id: 2, label: "メモ", categoryId: null, amount: 500, work: false, spreadSourceDate: null },
    ])
    const total = dailyExpense(period, entries).total
    assert.equal(items["2026-10-01"].reduce((a, i) => a + i.amount, 0), total[0])
})

test("按分で展開された行は、実際に払った日を持つ（#1268）", () => {
    const spread = { ...exp("2026-09-28", 12000, { lines: [{ amount: 12000, categoryId: 5 }] }), spreadMonths: 12, id: 1 }
    const items = dailyExpenseItems(p("2026-10-01", "2026-10-31"), expandSpread([spread]))
    assert.deepEqual(items["2026-10-28"], [{ id: 1, label: null, categoryId: 5, amount: 1000, work: false, spreadSourceDate: "2026-09-28" }])
})

// 仕事関連の色分け（#1258）
const cats = [
    { id: 1, name: "会社", parentId: null, order: 1, workRelated: true },
    { id: 2, name: "出張", parentId: 1, order: 1 },
    { id: 3, name: "食費", parentId: null, order: 2 },
]
const wp = p("2026-10-01", "2026-10-03")

test("仕事関連のカテゴリの品目は日別の仕事関連に入り、全体の合計は変わらない", () => {
    const entries = [
        exp("2026-10-01", 3000, { lines: [{ amount: 3000, categoryId: 3 }] }),
        exp("2026-10-02", 4000, { lines: [{ amount: 4000, categoryId: 2 }] }), // 中分類は大分類の属性を見る
    ]
    const d = dailyExpense(wp, entries, cats)
    assert.deepEqual(d.work, [0, 4000, 0])
    assert.deepEqual(d.total, [3000, 4000, 0])
})

test("仕事関連と通常の品目が混ざる取引は、品目の金額で分ける", () => {
    const d = dailyExpense(wp, [exp("2026-10-01", 5000, { lines: [{ amount: 2000, categoryId: 1 }, { amount: 3000, categoryId: 3 }] })], cats)
    assert.deepEqual(d.work, [2000, 0, 0])
    assert.deepEqual(d.total, [5000, 0, 0])
})

test("立て替えた分は仕事関連の金額からも按分で除く", () => {
    const d = dailyExpense(wp, [exp("2026-10-01", 4000, { advanceTotal: 2000, lines: [{ amount: 2000, categoryId: 1 }, { amount: 2000, categoryId: 3 }] })], cats)
    assert.deepEqual(d.work, [1000, 0, 0])
    assert.deepEqual(d.total, [2000, 0, 0])
})

test("特別な支出の印が付いた仕事関連の分は、仕事関連として数え、特別には重ねない", () => {
    const d = dailyExpense(wp, [exp("2026-10-01", 5000, { special: true, lines: [{ amount: 2000, categoryId: 1 }, { amount: 3000, categoryId: 3 }] })], cats)
    assert.deepEqual(d.work, [2000, 0, 0])
    assert.deepEqual(d.special, [3000, 0, 0])
    assert.deepEqual(d.regular, [0, 0, 0])
})

test("カテゴリを渡さない・品目が無いときは仕事関連は0", () => {
    assert.deepEqual(dailyExpense(wp, [exp("2026-10-01", 1000, { lines: [{ amount: 1000, categoryId: 1 }] })]).work, [0, 0, 0])
    assert.deepEqual(dailyExpense(wp, [exp("2026-10-01", 1000)], cats).work, [0, 0, 0])
})

test("computeSpendPace は日別の仕事関連を返し、日別の通常・特別・仕事の合計が日別の支出と一致する", () => {
    const entries = [
        exp("2026-10-01", 1000, { lines: [{ amount: 1000, categoryId: 3 }] }),
        exp("2026-10-01", 2000, { lines: [{ amount: 2000, categoryId: 1 }] }),
        exp("2026-10-01", 500, { special: true, lines: [{ amount: 500, categoryId: 3 }] }),
    ]
    const pace = computeSpendPace([wp], entries, "2026-10-02", cats)
    assert.deepEqual(pace.dailyWork, [2000, 0])
    assert.deepEqual(pace.dailySpecial, [500, 0])
    assert.equal(pace.daily[0], 3500)
})

test("日別明細は仕事関連の品目を含む取引に印を付ける", () => {
    const items = dailyExpenseItems(wp, [{ ...exp("2026-10-01", 3000, { lines: [{ amount: 3000, categoryId: 2 }] }), id: 1 }, { ...exp("2026-10-01", 100, { lines: [{ amount: 100, categoryId: 3 }] }), id: 2 }], cats)
    assert.deepEqual(items["2026-10-01"].map((i) => i.work), [true, false])
})
