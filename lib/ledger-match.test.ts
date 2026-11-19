import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
    bulkConfirmablePairs,
    dayDistance,
    matchStrength,
    readRejectedIds,
    decideRegistration,
    decideStatement,
    evidenceKindOf,
    exactCandidates,
    nearCandidates,
    dateToleranceOf,
    pendingFitsStatement,
    planStatementPart,
    statementPartCandidates,
    statementReceiptCandidates,
    subsetSumIncludes,
} from "./ledger-match"
import { entryTitle, isUncategorizedEntry, isUnassignedEntry } from "./ledger-filters"

const entries = [
    { id: 1, fromAccountId: 7, amount: 1000, date: "2026-11-01" },
    { id: 2, fromAccountId: 7, amount: 1000, date: "2026-11-02" },
    { id: 3, fromAccountId: 8, amount: 1000, date: "2026-11-01" },
    { id: 4, fromAccountId: 7, amount: 1050, date: "2026-11-01" },
    { id: 5, fromAccountId: 7, amount: 1500, date: "2026-11-01" },
]

describe("照合の幅", () => {
    it("レシートは同じ日だけ、メールは±3日", () => {
        assert.equal(dateToleranceOf(evidenceKindOf("PHOTO")), 0)
        assert.equal(dateToleranceOf(evidenceKindOf("SMART_RECEIPT")), 0)
        assert.equal(dateToleranceOf(evidenceKindOf("GMAIL")), 3)
        assert.equal(dateToleranceOf(evidenceKindOf("EXTERNAL_APP")), 3)
        assert.notEqual(evidenceKindOf("GMAIL"), evidenceKindOf("EXTERNAL_APP"))
        assert.equal(dayDistance("2026-10-30", "2026-11-02"), 3)
    })

    it("口座・金額が一致し、日付が幅の中の候補だけ", () => {
        const receipt = { accountId: 7, amount: 1000, date: "2026-11-01", tolerance: 0 }
        assert.deepEqual(exactCandidates(receipt, entries).map((e) => e.id), [1])
        const email = { ...receipt, tolerance: 3 }
        assert.deepEqual(exactCandidates(email, entries).map((e) => e.id), [1, 2])
    })

    it("金額が近いだけの候補（±10%）は別に返す", () => {
        assert.deepEqual(nearCandidates({ accountId: 7, amount: 1000, date: "2026-11-01", tolerance: 0 }, entries).map((e) => e.id), [4])
    })
})

describe("口座未定（#859）", () => {
    const withUnassigned = [...entries, { id: 6, fromAccountId: null, amount: 1000, date: "2026-11-01" }]

    it("カード明細から探すときは、同じ口座と口座未定の両方を候補にする", () => {
        const statement = { accountId: 7, amount: 1000, date: "2026-11-01", tolerance: 0, allowUnassigned: true }
        assert.deepEqual(exactCandidates(statement, withUnassigned).map((e) => e.id), [1, 6])
        assert.deepEqual(exactCandidates({ ...statement, allowUnassigned: false }, withUnassigned).map((e) => e.id), [1])
    })

    it("口座を問わない探し方は金額と日付だけで選び、金額が近いだけの候補は出さない", () => {
        const receipt = { accountId: null, amount: 1000, date: "2026-11-01", tolerance: 0 }
        assert.deepEqual(exactCandidates(receipt, withUnassigned).map((e) => e.id), [1, 3, 6])
        assert.deepEqual(nearCandidates(receipt, withUnassigned), [])
    })

    it("金額が近いだけの候補は、口座未定を含めない", () => {
        const near = [{ id: 9, fromAccountId: null, amount: 1050, date: "2026-11-01" }]
        assert.deepEqual(nearCandidates({ accountId: 7, amount: 1000, date: "2026-11-01", tolerance: 0, allowUnassigned: true }, near), [])
    })

    it("「違う」を押した候補のidを読む", () => {
        assert.deepEqual(readRejectedIds([3, "x", 4.5, 7]), [3, 7])
        assert.deepEqual(readRejectedIds(null), [])
    })
})

describe("decideRegistration", () => {
    it("候補があれば1件でも選ばせ、無ければ作る（口座未定は反映待ち）", () => {
        assert.deepEqual(decideRegistration(true, [5]), { action: "choose", candidateIds: [5] })
        assert.deepEqual(decideRegistration(true, []), { action: "create", status: "PENDING_STATEMENT" })
        assert.deepEqual(decideRegistration(null, []), { action: "create", status: "PENDING_STATEMENT" })
        assert.deepEqual(decideRegistration(false, []), { action: "create", status: "CONFIRMED" })
        assert.deepEqual(decideRegistration(true, [1, 2]), { action: "choose", candidateIds: [1, 2] })
    })
})

describe("decideStatement", () => {
    it("候補が1件でも照合待ちにし、自動では確定しない", () => {
        assert.deepEqual(decideStatement([3], []), { action: "hold", candidateIds: [3] })
        assert.deepEqual(decideStatement([3, 4], []), { action: "hold", candidateIds: [3, 4] })
        assert.deepEqual(decideStatement([], [9]), { action: "hold", candidateIds: [9] })
        assert.deepEqual(decideStatement([], []), { action: "create" })
    })
})

describe("まとめて確定", () => {
    const high = matchStrength({ amount: 1000, date: "2026-11-01" }, { amount: 1000, date: "2026-11-01" }, true)
    const dayOff = matchStrength({ amount: 1000, date: "2026-11-01" }, { amount: 1000, date: "2026-11-02" }, true)
    const otherStore = matchStrength({ amount: 1000, date: "2026-11-01" }, { amount: 1000, date: "2026-11-01" }, false)

    it("金額が同じ・同じ日・店名が近いときだけ一致の度合いが高い", () => {
        assert.equal(high.high, true)
        assert.equal(dayOff.high, false)
        assert.equal(dayOff.dayGap, 1)
        assert.equal(otherStore.high, false)
    })

    it("候補が1件で、ほかのカード明細と取り合いにならない組だけを選ぶ", () => {
        const pairs = bulkConfirmablePairs([
            { entryId: 1, candidates: [{ id: 10, strength: high }] },
            { entryId: 2, candidates: [{ id: 11, strength: high }, { id: 12, strength: high }] },
            { entryId: 3, candidates: [{ id: 13, strength: dayOff }] },
            { entryId: 4, candidates: [{ id: 14, strength: high }] },
            { entryId: 5, candidates: [{ id: 14, strength: high }] },
        ])
        assert.deepEqual(pairs, [{ entryId: 1, candidateId: 10 }])
    })
})

describe("ledger-filters", () => {
    it("未分類の判定", () => {
        assert.equal(isUncategorizedEntry({ kind: "EXPENSE", excludeFromTotals: false, lines: [{ categoryId: 1 }, { categoryId: null }] }), true)
        assert.equal(isUncategorizedEntry({ kind: "EXPENSE", excludeFromTotals: true, lines: [{ categoryId: null }] }), false)
        assert.equal(isUncategorizedEntry({ kind: "TRANSFER", excludeFromTotals: false, lines: [] }), false)
    })
    it("口座未定の判定（後払い・口座あり・支出以外は含めない）", () => {
        assert.equal(isUnassignedEntry({ kind: "EXPENSE", fromAccountId: null, counterparty: null }), true)
        assert.equal(isUnassignedEntry({ kind: "EXPENSE", fromAccountId: null, counterparty: "田中" }), false)
        assert.equal(isUnassignedEntry({ kind: "EXPENSE", fromAccountId: 1, counterparty: null }), false)
        assert.equal(isUnassignedEntry({ kind: "INCOME", fromAccountId: null, counterparty: null }), false)
    })
    it("取引の名前", () => {
        const base = { place: null, fromAccountName: "財布", toAccountName: null, lines: [] }
        assert.equal(entryTitle({ ...base, kind: "ADJUSTMENT" }), "財布 の残高調整")
        assert.equal(entryTitle({ ...base, kind: "TRANSFER", toAccountName: "PayPay" }), "財布 → PayPay")
        assert.equal(entryTitle({ ...base, kind: "EXPENSE", lines: [{ name: "牛乳" }] }), "牛乳")
    })
})

describe("statementReceiptCandidates（確定済みのカード明細から探す。Issue #912）", () => {
    const statement = { amount: 1280, date: "2026-11-03" }
    const rows = [
        { id: 1, amount: 1280, date: "2026-11-03" },
        { id: 2, amount: 1280, date: "2026-11-01" },
        { id: 3, amount: 1280, date: "2026-10-30" },
        { id: 4, amount: 1300, date: "2026-11-03" },
        { id: 5, amount: 1280, date: "2026-11-09" },
        { id: 6, amount: 2000, date: "2026-11-03" },
    ]

    it("既定は金額が同じで前後3日以内。近い日付の順", () => {
        assert.deepEqual(statementReceiptCandidates(statement, rows).map((r) => r.id), [1, 2])
    })

    it("広げると前後7日・金額±10%まで出し、金額が同じものを先にする", () => {
        assert.deepEqual(statementReceiptCandidates(statement, rows, { wide: true }).map((r) => r.id), [1, 2, 3, 5, 4])
    })

    it("「違う」を押したものは出さない", () => {
        assert.deepEqual(statementReceiptCandidates(statement, rows, { rejected: new Set([1]) }).map((r) => r.id), [2])
    })
})

describe("pendingFitsStatement（Issue #912）", () => {
    it("口座未定か同じ口座の反映待ちだけ。後払いは外す", () => {
        assert.equal(pendingFitsStatement(7, { fromAccountId: null, counterparty: null }), true)
        assert.equal(pendingFitsStatement(7, { fromAccountId: 7, counterparty: null }), true)
        assert.equal(pendingFitsStatement(7, { fromAccountId: 8, counterparty: null }), false)
        assert.equal(pendingFitsStatement(7, { fromAccountId: null, counterparty: "母" }), false)
    })
})

describe("金額が概算の候補（外貨建て。Issue #1510）", () => {
    // 請求メールはドルを換算した ¥17,600、カード明細はカード会社の換算で ¥18,246
    const card = { accountId: 7, amount: 18246, date: "2026-11-14", tolerance: 3, allowUnassigned: true }
    const pendings = [
        { id: 1, fromAccountId: null, amount: 17600, date: "2026-11-14", approximate: true },
        { id: 2, fromAccountId: null, amount: 17600, date: "2026-11-14" },
        { id: 3, fromAccountId: null, amount: 15000, date: "2026-11-14", approximate: true },
        { id: 4, fromAccountId: 8, amount: 17600, date: "2026-11-14", approximate: true },
    ]

    it("カード明細が届いたとき、口座未定でも概算の取引は金額が近ければ照合待ちの候補にする", () => {
        assert.deepEqual(nearCandidates(card, pendings).map((e) => e.id), [1])
        assert.deepEqual(nearCandidates({ ...card, allowUnassigned: false }, pendings), [])
    })

    it("確定済みのカード明細の既定の候補にも、概算の行は金額が近ければ出す（円建ては同じ金額だけ）", () => {
        assert.deepEqual(statementReceiptCandidates(card, pendings).map((r) => r.id), [1, 4])
    })

    it("一致の度合いに概算かを持たせる。金額が違うのでまとめて確定の対象にはしない", () => {
        const strength = matchStrength(card, pendings[0], true)
        assert.equal(strength.approximate, true)
        assert.equal(strength.sameAmount, false)
        assert.equal(strength.high, false)
        assert.equal(matchStrength(card, pendings[1], true).approximate, false)
    })
})

describe("まとめて引き落とされたカード明細の一部（Issue #1522）", () => {
    // Apple がサブスク2件（¥2,000・¥360）を ¥2,360 で1回に請求した。メールは数日前に届いている
    const card = { amount: 2360, date: "2026-11-13", lineAmounts: [2360] }
    const aqua = { id: 1, amount: 2000, date: "2026-11-07", place: "Aqua Voice, Inc." }
    const zaim = { id: 2, amount: 360, date: "2026-11-08", place: "Zaim" }

    it("ほかの反映待ちと足してカード明細の金額にちょうどなる組は、既定でも候補に出す", () => {
        assert.deepEqual(statementPartCandidates(card, [aqua, zaim]).map((r) => r.id), [2, 1])
    })

    it("手がかりが無い1件だけなら既定では出さず、条件を広げると出す", () => {
        assert.deepEqual(statementPartCandidates(card, [aqua]), [])
        assert.deepEqual(statementPartCandidates(card, [aqua], { wide: true }).map((r) => r.id), [1])
    })

    it("カード明細の品目に同じ金額の行がある（手で分けてある）なら、既定でも出す", () => {
        assert.deepEqual(statementPartCandidates({ ...card, lineAmounts: [360, 2000] }, [aqua]).map((r) => r.id), [1])
    })

    it("店名が近ければ既定でも出す", () => {
        assert.deepEqual(statementPartCandidates(card, [aqua], { sameStore: (r) => r.id === 1 }).map((r) => r.id), [1])
    })

    it("カード明細以上の金額・前後7日を超える・「違う」を押したものは出さない", () => {
        const rows = [
            { id: 3, amount: 2360, date: "2026-11-13" },
            { id: 4, amount: 3000, date: "2026-11-13" },
            { id: 5, amount: 2000, date: "2026-11-05" },
            { id: 6, amount: 0, date: "2026-11-13" },
            aqua,
        ]
        assert.deepEqual(statementPartCandidates(card, rows, { wide: true, rejected: new Set([1]) }), [])
    })

    it("部分和は、指定した1件を必ず含む組み合わせで探す", () => {
        assert.equal(subsetSumIncludes([2000, 360, 500], 0, 2360), true)
        assert.equal(subsetSumIncludes([2000, 360, 500], 2, 2360), false)
        assert.equal(subsetSumIncludes([1000, 1000, 360], 1, 2360), true)
        assert.equal(subsetSumIncludes([2360], 0, 2360), true)
        // 件数が多すぎるときは探さない（組み合わせが爆発するため）
        assert.equal(subsetSumIncludes(Array.from({ length: 13 }, () => 100), 0, 200), false)
    })
})

describe("カード明細から一部を切り出したあとの品目（Issue #1522）", () => {
    it("同じ金額の品目があれば外す（手で分けた品目と二重にしない）", () => {
        assert.deepEqual(planStatementPart(2360, [{ id: 10, amount: 360 }, { id: 11, amount: 2000 }], 2000), {
            remainder: 360,
            removeLineId: 11,
            updates: [],
            gapLine: null,
        })
    })

    it("品目が1つなら、その品目を残りの金額にする", () => {
        assert.deepEqual(planStatementPart(2360, [{ id: 10, amount: 2360 }], 2000), { remainder: 360, removeLineId: null, updates: [{ id: 10, amount: 360 }], gapLine: null })
    })

    it("品目がその1行だけで切り出す金額と同じなら、外さずに残りの金額へ書き換える", () => {
        assert.deepEqual(planStatementPart(2360, [{ id: 10, amount: 2000 }], 2000), { remainder: 360, removeLineId: null, updates: [{ id: 10, amount: 360 }], gapLine: null })
    })

    it("品目が複数で同じ金額の行が無ければ、差額の行を足す", () => {
        assert.deepEqual(planStatementPart(3000, [{ id: 10, amount: 1500 }, { id: 11, amount: 1500 }], 1000), {
            remainder: 2000,
            removeLineId: null,
            updates: [],
            gapLine: -1000,
        })
    })
})
