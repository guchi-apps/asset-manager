import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { AMOUNT_GAP_LINE_NAME, parseSelection, planAttach, resolveSelection, updatedAtMatches, type AttachPlanInput } from "@/lib/ledger-attach-preview"

function input(overrides: Partial<AttachPlanInput> = {}): AttachPlanInput {
    return {
        entry: { place: "AEON TOKYO", amount: 3480, fromAccountId: 1, status: "CONFIRMED", lines: [{ name: "食料品", amount: 3480 }] },
        receipt: { storeName: "イオン東京店" },
        receiptLines: [
            { name: "牛乳", amount: 198 },
            { name: "食パン", amount: 168 },
            { name: "鶏もも肉", amount: 3114 },
        ],
        kind: "receipt",
        account: null,
        entryAccountName: "三井住友カード",
        ...overrides,
    }
}

describe("planAttach（Issue #947）", () => {
    it("レシートは品目を置き換える。店名はすでに入っていれば初期値は変更しない", () => {
        const plan = planAttach(input())
        assert.equal(plan.lines.changes, true)
        assert.equal(plan.lines.after.length, 3)
        assert.equal(plan.place.changes, true)
        assert.equal(plan.place.defaultOn, false)
        assert.equal(plan.account.changes, false)
    })

    it("店名が空なら初期値で変更する。同じ店名なら変わらない", () => {
        assert.equal(planAttach(input({ entry: { ...input().entry, place: null } })).place.defaultOn, true)
        assert.equal(planAttach(input({ receipt: { storeName: "AEON TOKYO" } })).place.changes, false)
        assert.equal(planAttach(input({ receipt: { storeName: null } })).place.changes, false)
    })

    it("品目の合計が取引の金額と違えば差額の行を足す", () => {
        const plan = planAttach(input({ entry: { ...input().entry, amount: 4000 } }))
        assert.deepEqual(plan.lines.after.at(-1), { name: AMOUNT_GAP_LINE_NAME, amount: 520 })
    })

    it("メールは、付け先の品目が複数あれば置き換えない。1行なら置き換える", () => {
        const many = { ...input().entry, lines: [{ name: "a", amount: 1000 }, { name: "b", amount: 2480 }] }
        assert.equal(planAttach(input({ kind: "email", entry: many })).lines.changes, false)
        assert.equal(planAttach(input({ kind: "email" })).lines.changes, true)
    })

    it("口座は、口座未定の反映待ちに口座の決まったレシートを付けるときだけ変わる", () => {
        const pending = { ...input().entry, fromAccountId: null, status: "PENDING_STATEMENT" }
        const plan = planAttach(input({ entry: pending, account: { id: 2, name: "現金" }, entryAccountName: null }))
        assert.equal(plan.account.changes, true)
        assert.equal(plan.account.after, "現金")
        assert.equal(planAttach(input({ entry: pending, account: null, entryAccountName: null })).account.changes, false)
    })
})

describe("resolveSelection", () => {
    it("指定が無ければ既定に従い、変わらない項目は常にfalse", () => {
        const plan = planAttach(input())
        assert.deepEqual(resolveSelection(plan), { lines: true, place: false, account: false })
        assert.deepEqual(resolveSelection(plan, { account: true }), { lines: true, place: false, account: false })
    })

    it("項目ごとに外せる。店名は変更するを選べば上書きする", () => {
        const plan = planAttach(input())
        assert.deepEqual(resolveSelection(plan, { lines: false, place: true }), { lines: false, place: true, account: false })
    })
})

describe("parseSelection / updatedAtMatches", () => {
    it("真偽値以外は捨てる", () => {
        assert.deepEqual(parseSelection({ lines: false, place: "yes", account: 1, extra: true }), { lines: false })
        assert.deepEqual(parseSelection(null), {})
    })

    it("プレビュー後に取引が更新されていたら一致しない。指定が無ければ照合しない", () => {
        const at = new Date("2026-11-07T01:02:03.456Z")
        assert.equal(updatedAtMatches(at.toISOString(), at), true)
        assert.equal(updatedAtMatches("2026-11-07T01:02:04.000Z", at), false)
        assert.equal(updatedAtMatches("不正", at), false)
        assert.equal(updatedAtMatches(undefined, at), true)
    })
})
