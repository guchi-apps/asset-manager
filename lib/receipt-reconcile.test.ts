import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isNearAmount, reconcileReceipts, type ReconcileOptions, type ReconcileReceipt } from "./receipt-reconcile"
import type { ReplaceSourceEntry } from "./replace-target"

function entry(overrides: Partial<ReplaceSourceEntry> = {}): ReplaceSourceEntry {
    return {
        id: 10300000001,
        date: "2026-09-15",
        amount: 3278,
        account: "楽天カード",
        toAccount: "",
        place: "コメリ 足立店",
        name: "",
        comment: "",
        ...overrides,
    }
}

function receipt(overrides: Partial<ReconcileReceipt> = {}): ReconcileReceipt {
    return {
        id: 1,
        step: "review",
        source: "GMAIL",
        storeName: "コメリ",
        purchasedDate: "2026-09-15",
        totalAmount: 3278,
        itemCount: 3,
        cardAccountName: "楽天カード",
        ...overrides,
    }
}

const options: ReconcileOptions = {
    accountNames: ["楽天カード", "三井住友カード"],
    fromDate: "2026-08-17",
    coveredMonths: ["202608", "202609"],
    today: "2026-09-30",
}

describe("reconcileReceipts", () => {
    it("金額が同じで日付が前後3日以内なら一致にする", () => {
        const { pairs } = reconcileReceipts(
            [entry({ date: "2026-09-12" })],
            [receipt({ purchasedDate: "2026-09-11", step: "waiting" })],
            options
        )
        assert.equal(pairs.length, 1)
        assert.equal(pairs[0].kind, "matched")
        assert.equal(pairs[0].dayGap, 1)
        assert.equal(pairs[0].sameAccount, true)
        assert.equal(pairs[0].receipt?.step, "waiting")
    })

    it("片方にしか無いものは、Zaimにだけ・アプリにだけに分ける", () => {
        const { pairs } = reconcileReceipts(
            [entry({ amount: 648, place: "セブンイレブン" })],
            [receipt({ totalAmount: 12800 })],
            options
        )
        assert.deepEqual(
            pairs.map((pair) => pair.kind),
            ["zaimOnly", "appOnly"]
        )
    })

    it("4日以上ずれたら一致にしない", () => {
        const { pairs } = reconcileReceipts(
            [entry({ date: "2026-09-10" })],
            [receipt({ purchasedDate: "2026-09-14" })],
            options
        )
        assert.deepEqual(
            pairs.map((pair) => pair.kind),
            ["zaimOnly", "appOnly"]
        )
    })

    it("1件のZaim明細を2件の明細へ割り当てない。日付の近いほうを組にする", () => {
        const { pairs } = reconcileReceipts(
            [entry({ date: "2026-09-15" })],
            [
                receipt({ id: 1, purchasedDate: "2026-09-13" }),
                receipt({ id: 2, purchasedDate: "2026-09-15" }),
            ],
            options
        )
        assert.equal(pairs[0].kind, "matched")
        assert.equal(pairs[0].receipt?.id, 2)
        assert.equal(pairs[1].kind, "appOnly")
        assert.equal(pairs[1].receipt?.id, 1)
    })

    it("日付が近くても、登録先と同じ口座の組を優先する", () => {
        const { pairs } = reconcileReceipts(
            [
                entry({ id: 1, date: "2026-09-15", account: "三井住友カード" }),
                entry({ id: 2, date: "2026-09-17", account: "楽天カード" }),
            ],
            [receipt({ purchasedDate: "2026-09-15" })],
            options
        )
        assert.equal(pairs[0].kind, "matched")
        assert.equal(pairs[0].entry?.id, 2)
        assert.equal(pairs[0].sameAccount, true)
        assert.equal(pairs[1].kind, "zaimOnly")
    })

    it("突き合わせる口座以外・振替・当アプリが書いた行はZaim側に出さない", () => {
        const { pairs } = reconcileReceipts(
            [
                entry({ id: 1, account: "住信SBIネット銀行" }),
                entry({ id: 2, toAccount: "財布" }),
                entry({ id: 3, comment: "Asset Manager レシート取込 #12" }),
                entry({ id: 4, comment: "Asset Manager 複製 #999" }),
            ],
            [],
            options
        )
        assert.deepEqual(pairs, [])
    })

    it("突き合わせる口座以外の明細とも組にする（口座では絞らない）", () => {
        const { pairs } = reconcileReceipts(
            [entry({ account: "住信SBIネット銀行" })],
            [receipt()],
            options
        )
        assert.equal(pairs.length, 1)
        assert.equal(pairs[0].kind, "matched")
        assert.equal(pairs[0].sameAccount, false)
    })

    it("置き換え済みの明細と組になったZaim明細は、済んだものとして出さない", () => {
        const { pairs, uncheckedCount } = reconcileReceipts(
            [entry({ id: 1 }), entry({ id: 2, amount: 500 })],
            [
                receipt({ id: 1, step: "replaced" }),
                receipt({ id: 2, step: "replaced", totalAmount: 9999 }),
                receipt({ id: 3, step: "replaced", purchasedDate: null }),
            ],
            options
        )
        assert.deepEqual(
            pairs.map((pair) => pair.kind + ":" + pair.entry?.id),
            ["zaimOnly:2"]
        )
        assert.equal(uncheckedCount, 0)
    })

    it("日付の近い置き換え済みの明細と組になったら、手順にある明細は「アプリにだけ」に残る", () => {
        const { pairs } = reconcileReceipts(
            [entry({ id: 1, date: "2026-09-15" })],
            [
                receipt({ id: 1, step: "replaced", purchasedDate: "2026-09-15" }),
                receipt({ id: 2, step: "waiting", purchasedDate: "2026-09-13" }),
            ],
            options
        )
        assert.deepEqual(
            pairs.map((pair) => pair.kind + ":" + pair.receipt?.id),
            ["appOnly:2"]
        )
    })

    it("期間の少し手前の置き換え済みも、期間内のZaim明細の相手にする", () => {
        const { pairs } = reconcileReceipts(
            [entry({ date: "2026-08-18" })],
            [receipt({ step: "replaced", purchasedDate: "2026-08-15" })],
            options
        )
        assert.deepEqual(pairs, [])
    })

    it("重複の可能性に出たZaim明細とは組にせず、Zaimにだけあるにも出さない", () => {
        const { pairs } = reconcileReceipts([entry({ id: 55 })], [receipt({ id: 7 })], {
            ...options,
            excludedPairs: new Map([[7, new Set([55])]]),
        })
        assert.deepEqual(
            pairs.map((pair) => pair.kind),
            ["appOnly"]
        )
    })

    it("口座名の末尾の括弧書きは揃えて比べる", () => {
        const { pairs } = reconcileReceipts(
            [entry({ account: "楽天カード (自動連携)" })],
            [receipt()],
            options
        )
        assert.equal(pairs[0].kind, "matched")
        assert.equal(pairs[0].sameAccount, true)
    })

    it("期間より前のものは出さない", () => {
        const { pairs, uncheckedCount } = reconcileReceipts(
            [entry({ date: "2026-08-01" })],
            [receipt({ purchasedDate: "2026-08-01" })],
            options
        )
        assert.deepEqual(pairs, [])
        assert.equal(uncheckedCount, 0)
    })

    it("日付・金額が無い明細と、前後の月が読めていない明細は判定できない数に数える", () => {
        const { pairs, uncheckedCount } = reconcileReceipts(
            [],
            [
                receipt({ id: 1, purchasedDate: null }),
                receipt({ id: 2, totalAmount: null }),
                receipt({ id: 3, purchasedDate: "2026-09-29" }),
            ],
            { ...options, today: "2026-10-05" }
        )
        assert.deepEqual(pairs, [])
        assert.equal(uncheckedCount, 3)
    })

    it("前後の日付が今日より後なら、その月を読んでいなくても判定する", () => {
        const { pairs, uncheckedCount } = reconcileReceipts(
            [],
            [receipt({ purchasedDate: "2026-09-29" })],
            { ...options, today: "2026-09-30" }
        )
        assert.equal(pairs[0].kind, "appOnly")
        assert.equal(uncheckedCount, 0)
    })

    it("一致・Zaimにだけ・アプリにだけの順に、それぞれ新しい日付から並べる", () => {
        const { pairs } = reconcileReceipts(
            [
                entry({ id: 1, date: "2026-09-01", amount: 100 }),
                entry({ id: 2, date: "2026-09-10", amount: 100 }),
                entry({ id: 3, date: "2026-09-05", amount: 999 }),
            ],
            [
                receipt({ id: 1, purchasedDate: "2026-09-01", totalAmount: 100 }),
                receipt({ id: 2, purchasedDate: "2026-09-10", totalAmount: 100 }),
                receipt({ id: 3, purchasedDate: "2026-09-12", totalAmount: 5 }),
            ],
            options
        )
        assert.deepEqual(
            pairs.map((pair) => pair.kind + ":" + (pair.entry?.id ?? pair.receipt?.id)),
            ["matched:2", "matched:1", "zaimOnly:3", "appOnly:3"]
        )
    })
})

describe("reconcileReceipts（口座の種別。Issue #471）", () => {
    it("手入力・反映待ちの口座の明細は組にも「Zaimにだけ」にも出さない", () => {
        const kindOf = (name: string) =>
            name === "お財布" ? ("MANUAL" as const) : name === "反映待ち" ? ("PENDING" as const) : null
        const { pairs } = reconcileReceipts(
            [entry({ id: 1, account: "お財布" }), entry({ id: 2, account: "反映待ち" })],
            [receipt({ step: "waiting" })],
            { ...options, accountNames: ["楽天カード", "お財布", "反映待ち"], kindOf }
        )
        assert.deepEqual(
            pairs.map((pair) => pair.kind),
            ["appOnly"]
        )
    })

    describe("金額ずれ（Issue #483）", () => {
        it("概算の明細は、近い金額のZaim明細と「金額ずれ」の組にし、差を持つ", () => {
            const { pairs } = reconcileReceipts(
                [entry({ amount: 1512, date: "2026-09-15", place: "APPLE COM BILL" })],
                [receipt({ totalAmount: 1500, purchasedDate: "2026-09-14", amountApproximate: true, cardAccountName: null })],
                options
            )
            assert.equal(pairs.length, 1)
            assert.equal(pairs[0].kind, "amountGap")
            assert.equal(pairs[0].amountDiff, 12)
            assert.equal(pairs[0].dayGap, 1)
        })

        it("概算でなくても、同じ口座の明細どうしなら組にする", () => {
            const { pairs } = reconcileReceipts(
                [entry({ amount: 3168 })],
                [receipt({ totalAmount: 3040 })],
                options
            )
            assert.deepEqual(pairs.map((pair) => pair.kind), ["amountGap"])
            assert.equal(pairs[0].amountDiff, 128)
        })

        it("概算でも同じ口座でもない近い金額の2件は組にせず、片側だけの一覧に残す", () => {
            const { pairs } = reconcileReceipts(
                [entry({ amount: 1512, account: "三井住友カード" })],
                [receipt({ totalAmount: 1500, cardAccountName: "楽天カード" })],
                options
            )
            assert.deepEqual(pairs.map((pair) => pair.kind), ["zaimOnly", "appOnly"])
        })

        it("差が閾値（5%・少なくとも50円）を超えたら組にしない", () => {
            assert.equal(isNearAmount(500, 550), true)
            assert.equal(isNearAmount(500, 551), false)
            assert.equal(isNearAmount(10000, 10500), true)
            assert.equal(isNearAmount(10000, 10501), false)
            assert.equal(isNearAmount(1000, 1000), false)
            const { pairs } = reconcileReceipts(
                [entry({ amount: 500 })],
                [receipt({ totalAmount: 551, amountApproximate: true })],
                options
            )
            assert.deepEqual(pairs.map((pair) => pair.kind), ["zaimOnly", "appOnly"])
        })

        it("金額が一致する組を先に確定させ、金額ずれには残りだけを使う", () => {
            const { pairs } = reconcileReceipts(
                [entry({ id: 1, amount: 1500 }), entry({ id: 2, amount: 1512 })],
                [receipt({ id: 1, totalAmount: 1500, amountApproximate: true }), receipt({ id: 2, totalAmount: 1510 })],
                options
            )
            assert.deepEqual(
                pairs.map((pair) => [pair.kind, pair.entry?.id, pair.receipt?.id]),
                [
                    ["matched", 1, 1],
                    ["amountGap", 2, 2],
                ]
            )
        })

        it("置き換え済みの明細は金額ずれの相手にしない", () => {
            const { pairs } = reconcileReceipts(
                [entry({ amount: 1512 })],
                [receipt({ totalAmount: 1500, step: "replaced", amountApproximate: true })],
                options
            )
            assert.deepEqual(pairs.map((pair) => pair.kind), ["zaimOnly"])
        })

        it("重複の可能性に出たZaim明細とは金額ずれの組にもしない", () => {
            const { pairs } = reconcileReceipts(
                [entry({ id: 99, amount: 1512 })],
                [receipt({ id: 5, totalAmount: 1500, amountApproximate: true })],
                { ...options, excludedPairs: new Map([[5, new Set([99])]]) }
            )
            assert.deepEqual(pairs.map((pair) => pair.kind), ["appOnly"])
        })
    })
})
