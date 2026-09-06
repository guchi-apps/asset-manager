import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    computeHistoryPoints,
    type HistoryAssetRecord,
    type HistoryCategory,
} from "./history-compute"

const jst = (dayKey: string) => new Date(`${dayKey}T12:00:00+09:00`)

const category = (
    id: number,
    overrides: Partial<HistoryCategory> = {},
): HistoryCategory => ({
    id,
    name: `cat-${id}`,
    isLiability: false,
    isCash: false,
    parentId: null,
    tags: [],
    transactions: [],
    ...overrides,
})

const pointOf = (points: ReturnType<typeof computeHistoryPoints>, dayKey: string) => {
    const point = points.find((p) => p.date === dayKey)
    assert.ok(point, `${dayKey} の点がありません`)
    return point
}

/**
 * 負債はマイナスの評価額で持つ（#344・`lib/asset-breakdown.ts`）。
 * 取引のある日に評価額を 0 で切り上げると、返済を1件記録しただけで負債が消え、
 * 次に評価額が記録されるまで純資産が過大に出る。**Zaimの記録は日次で揃わない**ので
 * （`ZAIM_BACKFILL_MAX_DAYS = 1`）、穴の空いた日に取引が乗ると 0 が持ち越される。
 */
describe("computeHistoryPoints（負債）", () => {
    const categories: HistoryCategory[] = [
        category(1),
        category(2, {
            isLiability: true,
            transactions: [
                // 返済。負債の評価額は -100,000 → -70,000 へ動く
                { transactedAt: jst("2026-09-03"), amount: 30_000, type: "DEPOSIT", realizedGain: null },
            ],
        }),
    ]

    const records: HistoryAssetRecord[] = [
        { categoryId: 1, currentValue: 500_000, recordedAt: jst("2026-09-01") },
        { categoryId: 2, currentValue: -100_000, recordedAt: jst("2026-09-01") },
    ]

    const points = computeHistoryPoints(records, categories)

    it("総資産に負債を混ぜず、純資産としてだけ差し引く", () => {
        const first = pointOf(points, "2026-09-01")
        assert.equal(first.totalAssets, 500_000)
        assert.equal(first.totalLiabilities, 100_000)
        assert.equal(first.netWorth, 400_000)
    })

    it("返済の取引で負債が 0 へ丸められない", () => {
        const afterRepayment = pointOf(points, "2026-09-03")
        assert.equal(afterRepayment.totalAssets, 500_000)
        assert.equal(afterRepayment.totalLiabilities, 70_000)
        assert.equal(afterRepayment.netWorth, 430_000)
    })

    it("負債は取得額の系列に乗らない（損益に影響しない）", () => {
        const afterRepayment = pointOf(points, "2026-09-03")
        assert.equal(afterRepayment.totalCost, 0)
    })

    it("負債以外は従来どおり 0 で切り上げる", () => {
        const overdrawn = computeHistoryPoints(
            [{ categoryId: 1, currentValue: 10_000, recordedAt: jst("2026-09-01") }],
            [
                category(1, {
                    transactions: [
                        {
                            transactedAt: jst("2026-09-02"),
                            amount: 50_000,
                            type: "WITHDRAW",
                            realizedGain: null,
                        },
                    ],
                }),
            ],
        )
        assert.equal(pointOf(overdrawn, "2026-09-02").totalAssets, 0)
    })
})
