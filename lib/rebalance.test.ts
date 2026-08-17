import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    buildAllocationRows,
    buildProposal,
    findEffectiveTagOptionId,
    findMaxDriftRow,
    isAdjustNeeded,
    requiredTradeAmount,
    sumTotalValue,
    targetsFromCurrentRatios,
    type AllocationTargetRecord,
    type RebalanceCategory,
    type RebalanceTagGroup,
} from "./rebalance"

/**
 * 総資産 12,480,000円 のポートフォリオ。
 * mapCategoriesFromRows と同じく、子を持つカテゴリの ownValue は 0 になっている。
 */
const CATEGORIES: RebalanceCategory[] = [
    {
        id: 1,
        name: "米国株",
        color: "#f00",
        parentId: null,
        currentValue: 4_990_000,
        ownValue: 4_990_000,
        tagSettings: [{ groupId: 10, optionId: 101 }],
    },
    {
        id: 2,
        name: "日本株",
        color: "#0f0",
        parentId: null,
        currentValue: 1_500_000,
        ownValue: 1_500_000,
        tagSettings: [{ groupId: 10, optionId: 101 }],
    },
    {
        id: 3,
        name: "投資信託",
        color: "#00f",
        parentId: null,
        currentValue: 2_500_000,
        ownValue: 2_500_000,
        tagSettings: [{ groupId: 10, optionId: 101 }],
    },
    {
        id: 4,
        name: "暗号資産",
        color: "#ff0",
        parentId: null,
        currentValue: 990_000,
        ownValue: 990_000,
        tagSettings: [{ groupId: 10, optionId: 102 }],
    },
    {
        id: 5,
        name: "現金",
        color: "#888",
        parentId: null,
        currentValue: 2_500_000,
        ownValue: 2_500_000,
        isCash: true,
        tagSettings: [{ groupId: 10, optionId: 103 }],
    },
]

const TAG_GROUPS: RebalanceTagGroup[] = [
    {
        id: 10,
        name: "資産クラス",
        options: [
            { id: 101, name: "リスク資産" },
            { id: 102, name: "暗号資産" },
            { id: 103, name: "無リスク資産" },
        ],
    },
]

const CATEGORY_TARGETS: AllocationTargetRecord[] = [
    { categoryId: 1, tagGroupId: null, tagOptionId: null, ratio: 35 },
    { categoryId: 2, tagGroupId: null, tagOptionId: null, ratio: 15 },
    { categoryId: 3, tagGroupId: null, tagOptionId: null, ratio: 25 },
    { categoryId: 4, tagGroupId: null, tagOptionId: null, ratio: 5 },
    { categoryId: 5, tagGroupId: null, tagOptionId: null, ratio: 20 },
]

function categoryView(targets: AllocationTargetRecord[] = CATEGORY_TARGETS) {
    return buildAllocationRows({
        categories: CATEGORIES,
        tagGroups: TAG_GROUPS,
        targets,
        axis: { kind: "category" },
    })
}

describe("sumTotalValue", () => {
    it("トップレベルのカテゴリだけを合計する", () => {
        assert.equal(sumTotalValue(CATEGORIES), 12_480_000)
    })

    it("負債カテゴリを母数から除く", () => {
        const withLiability: RebalanceCategory[] = [
            ...CATEGORIES,
            {
                id: 9,
                name: "住宅ローン",
                parentId: null,
                currentValue: 20_000_000,
                ownValue: 20_000_000,
                isLiability: true,
            },
        ]
        assert.equal(sumTotalValue(withLiability), 12_480_000)
    })

    it("子カテゴリを二重に数えない", () => {
        const nested: RebalanceCategory[] = [
            { id: 1, name: "株式", parentId: null, currentValue: 300, ownValue: 0 },
            { id: 2, name: "米国株", parentId: 1, currentValue: 200, ownValue: 200 },
            { id: 3, name: "日本株", parentId: 1, currentValue: 100, ownValue: 100 },
        ]
        assert.equal(sumTotalValue(nested), 300)
    })
})

describe("buildAllocationRows（カテゴリ軸）", () => {
    it("現在の構成比・ズレ・金額差を出す", () => {
        const { rows, totalValue, hasTargets, targetSum } = categoryView()

        assert.equal(totalValue, 12_480_000)
        assert.equal(hasTargets, true)
        assert.equal(targetSum, 100)
        assert.equal(rows.length, 5)

        const us = rows.find((r) => r.name === "米国株")!
        assert.equal(us.targetRatio, 35)
        assert.ok(Math.abs(us.currentRatio - 39.98) < 0.01)
        assert.ok(Math.abs((us.driftPt ?? 0) - 4.98) < 0.01)
        // 目標額 4,368,000円 に対して現在 4,990,000円 → 622,000円 の超過
        assert.equal(Math.round(us.diffValue ?? 0), -622_000)

        const fund = rows.find((r) => r.name === "投資信託")!
        assert.equal(Math.round(fund.diffValue ?? 0), 620_000)
    })

    it("目標未設定なら driftPt も diffValue も null になる", () => {
        const { rows, hasTargets } = categoryView([])
        assert.equal(hasTargets, false)
        assert.ok(rows.every((r) => r.driftPt === null && r.diffValue === null))
    })

    it("評価額0で目標も無いカテゴリは並べない", () => {
        const withEmpty: RebalanceCategory[] = [
            ...CATEGORIES,
            { id: 6, name: "未使用", parentId: null, currentValue: 0, ownValue: 0 },
        ]
        const view = buildAllocationRows({
            categories: withEmpty,
            tagGroups: TAG_GROUPS,
            targets: CATEGORY_TARGETS,
            axis: { kind: "category" },
        })
        assert.equal(view.rows.find((r) => r.name === "未使用"), undefined)
    })

    it("評価額0でも目標があれば並べる", () => {
        const withEmpty: RebalanceCategory[] = [
            ...CATEGORIES,
            { id: 6, name: "これから買う", parentId: null, currentValue: 0, ownValue: 0 },
        ]
        const view = buildAllocationRows({
            categories: withEmpty,
            tagGroups: TAG_GROUPS,
            targets: [
                ...CATEGORY_TARGETS,
                { categoryId: 6, tagGroupId: null, tagOptionId: null, ratio: 10 },
            ],
            axis: { kind: "category" },
        })
        const row = view.rows.find((r) => r.name === "これから買う")
        assert.ok(row)
        assert.equal(row.currentValue, 0)
        assert.equal(row.targetRatio, 10)
    })
})

describe("buildAllocationRows（タグ軸）", () => {
    it("タグ選択肢ごとに ownValue を積み上げる", () => {
        const { rows, totalValue } = buildAllocationRows({
            categories: CATEGORIES,
            tagGroups: TAG_GROUPS,
            targets: [
                { categoryId: null, tagGroupId: 10, tagOptionId: 101, ratio: 75 },
                { categoryId: null, tagGroupId: 10, tagOptionId: 102, ratio: 5 },
                { categoryId: null, tagGroupId: 10, tagOptionId: 103, ratio: 20 },
            ],
            axis: { kind: "tagGroup", tagGroupId: 10 },
        })

        assert.equal(totalValue, 12_480_000)
        const risk = rows.find((r) => r.name === "リスク資産")!
        assert.equal(risk.currentValue, 8_990_000)
        assert.equal(risk.targetRatio, 75)
        assert.equal(rows.reduce((sum, r) => sum + r.currentValue, 0), 12_480_000)
    })

    it("どのタグにも属さない資産を未分類にまとめる", () => {
        const categories: RebalanceCategory[] = [
            {
                id: 1,
                name: "米国株",
                parentId: null,
                currentValue: 600,
                ownValue: 600,
                tagSettings: [{ groupId: 10, optionId: 101 }],
            },
            { id: 2, name: "ポイント", parentId: null, currentValue: 400, ownValue: 400 },
        ]
        const { rows } = buildAllocationRows({
            categories,
            tagGroups: TAG_GROUPS,
            targets: [],
            axis: { kind: "tagGroup", tagGroupId: 10 },
        })

        const unassigned = rows.find((r) => r.isUnassigned)!
        assert.equal(unassigned.name, "未分類")
        assert.equal(unassigned.currentValue, 400)
        assert.equal(unassigned.targetRatio, null)
    })
})

describe("findEffectiveTagOptionId", () => {
    const categories: RebalanceCategory[] = [
        {
            id: 1,
            name: "株式",
            parentId: null,
            currentValue: 300,
            ownValue: 0,
            tagSettings: [{ groupId: 10, optionId: 101 }],
        },
        { id: 2, name: "米国株", parentId: 1, currentValue: 200, ownValue: 200 },
        {
            id: 3,
            name: "日本株",
            parentId: 1,
            currentValue: 100,
            ownValue: 100,
            tagSettings: [{ groupId: 10, optionId: 102 }],
        },
    ]
    const byId = new Map(categories.map((c) => [c.id, c]))

    it("設定が無ければ親のタグを継承する", () => {
        assert.equal(findEffectiveTagOptionId(categories[1], byId, 10), 101)
    })

    it("自分の設定が親より優先される", () => {
        assert.equal(findEffectiveTagOptionId(categories[2], byId, 10), 102)
    })

    it("親子が循環していても止まる", () => {
        const looped: RebalanceCategory[] = [
            { id: 1, name: "A", parentId: 2, currentValue: 1, ownValue: 1 },
            { id: 2, name: "B", parentId: 1, currentValue: 1, ownValue: 1 },
        ]
        const loopedById = new Map(looped.map((c) => [c.id, c]))
        assert.equal(findEffectiveTagOptionId(looped[0], loopedById, 10), null)
    })
})

describe("buildProposal（買い増しのみ）", () => {
    it("追加投資額を不足している項目に不足額の比率で配る", () => {
        const { rows, totalValue } = categoryView()
        const result = buildProposal({
            rows,
            totalValue,
            extraAmount: 300_000,
            mode: "buyOnly",
        })

        assert.equal(result.sellTotal, 0)
        assert.equal(result.buyTotal, 300_000)
        assert.equal(
            result.items.reduce((sum, i) => sum + i.amount, 0),
            300_000,
        )
        // 不足が大きい投資信託に最も多く配られる
        assert.equal(result.items[0].name, "投資信託")
        assert.ok(result.items.every((i) => i.amount > 0))
        // 買い増しだけでも目標へのズレは縮む
        assert.ok(result.maxDriftAfter < result.maxDriftBefore)
    })

    it("追加投資額が0なら提案を出さない", () => {
        const { rows, totalValue } = categoryView()
        const result = buildProposal({ rows, totalValue, extraAmount: 0, mode: "buyOnly" })

        assert.deepEqual(result.items, [])
        assert.ok(result.maxDriftBefore > 0)
        assert.ok(result.shortfallTotal > 0)
    })

    it("追加投資額が大きければ超過していた項目にも回る", () => {
        const { rows, totalValue } = categoryView()
        const result = buildProposal({
            rows,
            totalValue,
            extraAmount: 10_000_000,
            mode: "buyOnly",
        })

        assert.equal(
            result.items.reduce((sum, i) => sum + i.amount, 0),
            10_000_000,
        )
        assert.equal(result.items.length, 5)
        assert.ok(result.items.every((i) => i.amount > 0))
    })

    it("不足合計を超える追加投資額は、埋めたうえで残りを目標比率どおりに配る", () => {
        // 目標の合計が60%（目標を持たない資産がある）ため、不足を埋めてもなお余る
        const partialTargets: AllocationTargetRecord[] = [
            { categoryId: 1, tagGroupId: null, tagOptionId: null, ratio: 30 },
            { categoryId: 3, tagGroupId: null, tagOptionId: null, ratio: 30 },
        ]
        const { rows, totalValue } = categoryView(partialTargets)
        const result = buildProposal({
            rows,
            totalValue,
            extraAmount: 20_000_000,
            mode: "buyOnly",
        })

        assert.equal(
            result.items.reduce((sum, i) => sum + i.amount, 0),
            20_000_000,
        )
        assert.equal(result.items.length, 2)
        // 不足 4,754,000円 を埋めたうえで、余り 8,002,000円 の半分が上乗せされる
        assert.equal(result.items.find((i) => i.name === "米国株")?.amount, 8_755_000)
    })

    it("目標が未設定なら提案を出さない", () => {
        const { rows, totalValue } = categoryView([])
        const result = buildProposal({
            rows,
            totalValue,
            extraAmount: 300_000,
            mode: "buyOnly",
        })
        assert.deepEqual(result.items, [])
    })

    it("丸め単位に満たない項目を落としても合計は追加投資額と一致する", () => {
        const { rows, totalValue } = categoryView()
        const result = buildProposal({
            rows,
            totalValue,
            extraAmount: 12_345,
            mode: "buyOnly",
        })

        assert.equal(
            result.items.reduce((sum, i) => sum + i.amount, 0),
            12_345,
        )
        assert.ok(result.skippedCount > 0)
    })
})

describe("buildProposal（売買あり）", () => {
    it("超過を売り、不足を買って売買金額が釣り合う", () => {
        const { rows, totalValue } = categoryView()
        const result = buildProposal({ rows, totalValue, mode: "buySell" })

        assert.ok(result.buyTotal > 0)
        assert.ok(result.sellTotal > 0)
        assert.equal(result.buyTotal, result.sellTotal)
        assert.ok(Math.abs(result.maxDriftAfter) < 0.01)

        const us = result.items.find((i) => i.name === "米国株")!
        assert.ok(us.amount < 0)
        const fund = result.items.find((i) => i.name === "投資信託")!
        assert.ok(fund.amount > 0)
    })

    it("目標を持たない資産があっても、売り買いを釣り合わせようとしない", () => {
        const partialTargets: AllocationTargetRecord[] = [
            { categoryId: 1, tagGroupId: null, tagOptionId: null, ratio: 30 },
            { categoryId: 3, tagGroupId: null, tagOptionId: null, ratio: 30 },
        ]
        const { rows, totalValue } = categoryView(partialTargets)
        const result = buildProposal({ rows, totalValue, mode: "buySell" })

        // 米国株は目標30%（3,744,000円）に対して超過、投資信託は不足
        const us = result.items.find((i) => i.name === "米国株")!
        const fund = result.items.find((i) => i.name === "投資信託")!
        assert.equal(us.amount, -1_246_000)
        assert.equal(fund.amount, 1_244_000)
        assert.equal(result.items.length, 2)
    })
})

describe("isAdjustNeeded", () => {
    it("画面に出る値（小数第1位）で判定する", () => {
        // 4.98pt は「+5.0pt」と表示されるので、しきい値5ptなら要調整にする
        assert.equal(isAdjustNeeded(4.98, 5), true)
        assert.equal(isAdjustNeeded(-4.98, 5), true)
        assert.equal(isAdjustNeeded(4.94, 5), false)
        assert.equal(isAdjustNeeded(null, 5), false)
    })
})

describe("requiredTradeAmount / findMaxDriftRow", () => {
    it("買い側・売り側の必要額を出す", () => {
        const { rows } = categoryView()
        const { buy, sell } = requiredTradeAmount(rows)

        assert.equal(Math.round(buy), 992_000)
        assert.equal(Math.round(sell), 992_000)
    })

    it("最もズレが大きい行を返す", () => {
        const { rows } = categoryView()
        assert.equal(findMaxDriftRow(rows)?.name, "米国株")
    })

    it("目標が無ければ null", () => {
        const { rows } = categoryView([])
        assert.equal(findMaxDriftRow(rows), null)
    })
})

describe("targetsFromCurrentRatios", () => {
    it("現在の構成比を合計100%に丸めて返す", () => {
        const { rows } = categoryView([])
        const targets = targetsFromCurrentRatios(rows)

        assert.equal(targets.length, 5)
        assert.equal(
            Math.round(targets.reduce((sum, t) => sum + t.ratio, 0) * 10) / 10,
            100,
        )
    })

    it("未分類は目標に含めない", () => {
        const categories: RebalanceCategory[] = [
            {
                id: 1,
                name: "米国株",
                parentId: null,
                currentValue: 600,
                ownValue: 600,
                tagSettings: [{ groupId: 10, optionId: 101 }],
            },
            { id: 2, name: "ポイント", parentId: null, currentValue: 400, ownValue: 400 },
        ]
        const { rows } = buildAllocationRows({
            categories,
            tagGroups: TAG_GROUPS,
            targets: [],
            axis: { kind: "tagGroup", tagGroupId: 10 },
        })
        const targets = targetsFromCurrentRatios(rows)

        assert.equal(targets.length, 1)
        assert.equal(targets[0].ratio, 100)
    })
})
