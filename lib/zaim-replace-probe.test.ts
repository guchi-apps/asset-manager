import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    PROBE_COMMENT_MARKER,
    buildProbeCases,
    buildProbeComment,
    collectProbeEntries,
    isProbeEntry,
    pickEditProbeTarget,
    pickProbeTarget,
    type ProbeMoneyEntry,
} from "./zaim-replace-probe"

const CARD = 21678522
const PENDING = 16525399

function entry(overrides: Partial<ProbeMoneyEntry> & Pick<ProbeMoneyEntry, "id">): ProbeMoneyEntry {
    return {
        date: "2026-08-27",
        amount: 171,
        fromAccountId: CARD,
        categoryId: 101,
        genreId: 10101,
        name: "",
        place: "",
        comment: "",
        active: 1,
        ...overrides,
    }
}

describe("pickProbeTarget", () => {
    it("素の連携カード明細のうち最も新しいものを選ぶ", () => {
        const target = pickProbeTarget(
            [
                entry({ id: 1, date: "2026-08-20", amount: 500 }),
                entry({ id: 2, date: "2026-08-27", amount: 171 }),
                entry({ id: 3, date: "2026-08-25", amount: 348 }),
            ],
            CARD
        )
        assert.equal(target?.id, 2)
    })

    it("同じ日付なら後から入った明細を新しいものとして扱う", () => {
        const target = pickProbeTarget(
            [
                entry({ id: 10, date: "2026-08-27", amount: 500 }),
                entry({ id: 11, date: "2026-08-27", amount: 171 }),
            ],
            CARD
        )
        assert.equal(target?.id, 11)
    })

    it("品目やコメントが入っている明細は選ばない（人が編集済み・置き換え済みの可能性がある）", () => {
        const target = pickProbeTarget(
            [
                entry({ id: 1, date: "2026-08-27", amount: 171, name: "LWクリームパン4個入" }),
                entry({ id: 2, date: "2026-08-26", amount: 500, comment: "商品数量 * 2" }),
                entry({ id: 3, date: "2026-08-20", amount: 800 }),
            ],
            CARD
        )
        assert.equal(target?.id, 3)
    })

    it("日付と金額が同じ明細が複数あるものは、候補の判別が付かないので選ばない", () => {
        const target = pickProbeTarget(
            [
                entry({ id: 1, date: "2026-08-27", amount: 171 }),
                entry({ id: 2, date: "2026-08-27", amount: 171 }),
                entry({ id: 3, date: "2026-08-20", amount: 800 }),
            ],
            CARD
        )
        assert.equal(target?.id, 3)
    })

    it("重複判定は口座をまたいで数える（反映待ちに同額があるものも避ける）", () => {
        const target = pickProbeTarget(
            [
                entry({ id: 1, date: "2026-08-27", amount: 171 }),
                entry({ id: 2, date: "2026-08-27", amount: 171, fromAccountId: PENDING }),
                entry({ id: 3, date: "2026-08-20", amount: 800 }),
            ],
            CARD
        )
        assert.equal(target?.id, 3)
    })

    it("他の口座・返金行・集計対象外は選ばない", () => {
        const target = pickProbeTarget(
            [
                entry({ id: 1, date: "2026-08-28", fromAccountId: PENDING, amount: 900 }),
                entry({ id: 2, date: "2026-08-27", amount: -112 }),
                entry({ id: 3, date: "2026-08-26", amount: 700, active: 0 }),
                entry({ id: 4, date: "2026-08-20", amount: 800 }),
            ],
            CARD
        )
        assert.equal(target?.id, 4)
    })

    it("条件に合うものが無ければ null", () => {
        assert.equal(pickProbeTarget([entry({ id: 1, name: "コーヒー" })], CARD), null)
        assert.equal(pickProbeTarget([], CARD), null)
    })
})

describe("buildProbeCases", () => {
    const target = entry({ id: 99, date: "2026-08-27", amount: 171, place: "ローソン 高槻城北町二丁目" })
    const cases = buildProbeCases(target, { pendingAccountId: PENDING, cardAccountId: CARD })

    it("出金元だけが違う2件を作る", () => {
        assert.equal(cases.length, 2)
        assert.equal(cases[0].caseId, "A")
        assert.equal(cases[0].fromAccountId, PENDING)
        assert.equal(cases[1].caseId, "B")
        assert.equal(cases[1].fromAccountId, CARD)
    })

    it("日付・金額・カテゴリ・内訳・店舗名は的の明細から引き継ぐ", () => {
        for (const probe of cases) {
            assert.equal(probe.date, "2026-08-27")
            assert.equal(probe.amount, 171)
            assert.equal(probe.categoryId, target.categoryId)
            assert.equal(probe.genreId, target.genreId)
            assert.equal(probe.place, "ローソン 高槻城北町二丁目")
        }
    })

    it("品目は必ず入れる（置き換えの条件が「品目の記載があるか」のため）", () => {
        for (const probe of cases) assert.ok(probe.name.length > 0)
    })

    it("店舗名が空の明細でも、店舗名を空のまま登録しない", () => {
        const [caseA] = buildProbeCases(entry({ id: 1, place: "" }), {
            pendingAccountId: PENDING,
            cardAccountId: CARD,
        })
        assert.equal(caseA.place, "置き換え検証")
    })

    it("後片付けできるよう、コメントへ印を入れる", () => {
        assert.equal(cases[0].comment, `${PROBE_COMMENT_MARKER} [A]`)
        assert.equal(cases[1].comment, buildProbeComment("B"))
        for (const probe of cases) assert.ok(isProbeEntry(probe))
    })
})

describe("collectProbeEntries", () => {
    it("印の付いた明細だけを後片付けの対象にする", () => {
        const found = collectProbeEntries([
            entry({ id: 1, comment: buildProbeComment("A") }),
            entry({ id: 2, comment: "Asset Manager レシート取込 #18" }),
            entry({ id: 3, comment: "" }),
            entry({ id: 4, comment: buildProbeComment("B") }),
        ])
        assert.deepEqual(
            found.map((item) => item.id),
            [1, 4]
        )
    })
})

describe("pickEditProbeTarget", () => {
    it("内訳が決まっている連携カード明細のうち最も新しいものを選ぶ", () => {
        const target = pickEditProbeTarget(
            [
                entry({ id: 1, date: "2026-08-20", name: "ガス なっとくプラン" }),
                entry({ id: 2, date: "2026-08-27", name: "LWクリームパン4個入" }),
            ],
            CARD
        )
        assert.equal(target?.id, 2)
    })

    it("内訳・カテゴリが空の明細は選ばない（弾かれた理由が判別できなくなる）", () => {
        const target = pickEditProbeTarget(
            [
                entry({ id: 1, date: "2026-08-27", genreId: 0 }),
                entry({ id: 2, date: "2026-08-26", categoryId: 0 }),
                entry({ id: 3, date: "2026-08-20" }),
            ],
            CARD
        )
        assert.equal(target?.id, 3)
    })

    it("検証で作った明細は的にしない（連携明細でないため確かめたいことがずれる）", () => {
        const target = pickEditProbeTarget(
            [
                entry({ id: 1, date: "2026-08-27", comment: buildProbeComment("B") }),
                entry({ id: 2, date: "2026-08-20" }),
            ],
            CARD
        )
        assert.equal(target?.id, 2)
    })
})
