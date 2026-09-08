import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    checkTagAxisCompatibility,
    computeMemberships,
    computeOptionBounds,
    deriveTagTargets,
    categoryTargetsOf,
    findStoredConflicts,
    findTagMismatches,
    fitCategoryTargetsToTagTargets,
    rescaleCategoryTargets,
    roundToHundred,
} from "./rebalance-consistency"
import {
    buildAllocationRows,
    EXCLUDED_BY_CATEGORY_KEY,
    type AllocationTargetRecord,
    type RebalanceCategory,
    type RebalanceTagGroup,
} from "./rebalance"

const ASSET_CLASS = 10
const CURRENCY = 20
const STOCK = 101
const BOND = 102
const CASH = 103
const USD = 201
const JPY = 202

/**
 * 米国株 40 / 日本株 15 / 先進国債券 20 / 国内債券 10 / 現金 10 / 暗号資産 5（タグ未設定）。
 * 資産クラス別に足すと 株式 55 / 債券 30 / 現金 10 / 未分類 5、通貨別は 米ドル 60 / 円 35 / 未分類 5。
 */
const CATEGORIES: RebalanceCategory[] = [
    cat(1, "米国株", 4_000_000, [[ASSET_CLASS, STOCK], [CURRENCY, USD]]),
    cat(2, "日本株", 1_500_000, [[ASSET_CLASS, STOCK], [CURRENCY, JPY]]),
    cat(3, "先進国債券", 2_000_000, [[ASSET_CLASS, BOND], [CURRENCY, USD]]),
    cat(4, "国内債券", 1_000_000, [[ASSET_CLASS, BOND], [CURRENCY, JPY]]),
    cat(5, "現金", 1_000_000, [[ASSET_CLASS, CASH], [CURRENCY, JPY]]),
    cat(6, "暗号資産", 500_000, []),
]

const TAG_GROUPS: RebalanceTagGroup[] = [
    {
        id: ASSET_CLASS,
        name: "資産クラス",
        options: [
            { id: STOCK, name: "株式" },
            { id: BOND, name: "債券" },
            { id: CASH, name: "現金" },
        ],
    },
    {
        id: CURRENCY,
        name: "通貨",
        options: [
            { id: USD, name: "米ドル" },
            { id: JPY, name: "円" },
        ],
    },
]

const CATEGORY_TARGETS: AllocationTargetRecord[] = [
    categoryTarget(1, 40),
    categoryTarget(2, 15),
    categoryTarget(3, 20),
    categoryTarget(4, 10),
    categoryTarget(5, 10),
    categoryTarget(6, 5),
]

function cat(
    id: number,
    name: string,
    value: number,
    tags: [number, number][],
    extra: Partial<RebalanceCategory> = {},
): RebalanceCategory {
    return {
        id,
        name,
        parentId: null,
        currentValue: value,
        ownValue: value,
        tagSettings: tags.map(([groupId, optionId]) => ({ groupId, optionId })),
        ...extra,
    }
}

function categoryTarget(categoryId: number, ratio: number, excluded = false): AllocationTargetRecord {
    return { categoryId, tagGroupId: null, tagOptionId: null, ratio, excluded }
}

function tagTarget(tagGroupId: number, tagOptionId: number | null, ratio: number, excluded = false): AllocationTargetRecord {
    return { categoryId: null, tagGroupId, tagOptionId, ratio, excluded }
}

function ratioMap(entries: { key: number | null; ratio: number; excluded: boolean }[]) {
    return new Map(entries.map((e) => [e.key, e.excluded ? "excluded" : Math.round(e.ratio * 10) / 10]))
}

describe("computeMemberships", () => {
    it("最上位カテゴリごとに、選択肢への所属の割合を求める", () => {
        const memberships = computeMemberships(CATEGORIES, ASSET_CLASS)
        assert.deepEqual(memberships.get(1), new Map([[STOCK, 1]]))
        assert.deepEqual(memberships.get(6), new Map([[null, 1]]))
    })

    it("子カテゴリが親と違うタグを持つときは、評価額の内訳比で按分する", () => {
        const categories: RebalanceCategory[] = [
            { ...cat(1, "投資信託", 1_000_000, [[ASSET_CLASS, STOCK]]), ownValue: 0 },
            { ...cat(11, "S&P500", 700_000, []), parentId: 1 },
            { ...cat(12, "先進国債券ファンド", 300_000, [[ASSET_CLASS, BOND]]), parentId: 1 },
        ]
        const memberships = computeMemberships(categories, ASSET_CLASS)
        assert.deepEqual(memberships.get(1), new Map([[STOCK, 0.7], [BOND, 0.3]]))
    })

    it("評価額が0のカテゴリは、自身に効いている選択肢へ全部を割り当てる", () => {
        const memberships = computeMemberships([cat(1, "新規", 0, [[ASSET_CLASS, CASH]])], ASSET_CLASS)
        assert.deepEqual(memberships.get(1), new Map([[CASH, 1]]))
    })
})

describe("deriveTagTargets", () => {
    it("同じ選択肢に属するカテゴリの目標を足し合わせる。タグ未設定の目標は未分類に出る", () => {
        const derived = deriveTagTargets(CATEGORIES, categoryTargetsOf(CATEGORY_TARGETS), ASSET_CLASS)
        assert.deepEqual(
            ratioMap(derived),
            new Map<number | null, number | string>([[STOCK, 55], [BOND, 30], [CASH, 10], [null, 5]]),
        )
        const stock = derived.find((d) => d.key === STOCK)!
        assert.deepEqual(stock.parts, [{ categoryId: 1, ratio: 40 }, { categoryId: 2, ratio: 15 }])
    })

    it("選択肢に属するカテゴリがすべて除外なら、その選択肢も除外になる", () => {
        const targets = [categoryTarget(1, 50), categoryTarget(2, 20), categoryTarget(3, 30), categoryTarget(5, 0, true)]
        const derived = deriveTagTargets(CATEGORIES, categoryTargetsOf(targets), ASSET_CLASS)
        assert.equal(ratioMap(derived).get(CASH), "excluded")
        assert.equal(ratioMap(derived).get(STOCK), 70)
        // 目標を持つカテゴリが無い選択肢（未分類）は返さない
        assert.equal(derived.some((d) => d.key === null), false)
    })
})

describe("buildAllocationRows（算出モード）", () => {
    it("カテゴリ別の目標があるタグ軸は、保存済みの行を無視して算出値を使う", () => {
        const view = buildAllocationRows({
            categories: CATEGORIES,
            tagGroups: TAG_GROUPS,
            // 保存済みの古い値（株式 70）は使われない
            targets: [...CATEGORY_TARGETS, tagTarget(ASSET_CLASS, STOCK, 70), tagTarget(ASSET_CLASS, BOND, 30)],
            axis: { kind: "tagGroup", tagGroupId: ASSET_CLASS },
        })
        assert.equal(view.derived, true)
        const byKey = new Map(view.rows.map((r) => [r.key, r]))
        assert.equal(byKey.get(`tagOption:${STOCK}`)?.targetRatio, 55)
        assert.equal(byKey.get(`tagOption:${BOND}`)?.targetRatio, 30)
        assert.equal(byKey.get("unassigned")?.targetRatio, 5)
        assert.equal(view.targetSum, 100)
    })

    it("カテゴリ別の除外は算出モードのタグ軸にも効き、母数から差し引く", () => {
        // 現金を除外。現金の選択肢には現金カテゴリしか無いので、選択肢ごと除外になる
        const targets = [categoryTarget(1, 50), categoryTarget(2, 20), categoryTarget(3, 30), categoryTarget(4, 0), categoryTarget(6, 0), categoryTarget(5, 0, true)]
        const view = buildAllocationRows({
            categories: CATEGORIES,
            tagGroups: TAG_GROUPS,
            targets,
            axis: { kind: "tagGroup", tagGroupId: ASSET_CLASS },
        })
        const cash = view.rows.find((r) => r.key === `tagOption:${CASH}`)!
        assert.equal(cash.isExcluded, true)
        assert.equal(cash.currentValue, 1_000_000)
        assert.equal(view.totalValue, 9_000_000)
        assert.equal(view.rows.some((r) => r.key === EXCLUDED_BY_CATEGORY_KEY), false)
    })

    it("除外していない選択肢に混ざった除外カテゴリは「カテゴリ別で除外した資産」の行にまとめる", () => {
        // 日本株（株式・円）を除外。株式には米国株が残るので選択肢は残り、日本株の評価額だけを別行へ
        const targets = [categoryTarget(1, 50), categoryTarget(3, 30), categoryTarget(4, 10), categoryTarget(5, 10), categoryTarget(6, 0), categoryTarget(2, 0, true)]
        const view = buildAllocationRows({
            categories: CATEGORIES,
            tagGroups: TAG_GROUPS,
            targets,
            axis: { kind: "tagGroup", tagGroupId: ASSET_CLASS },
        })
        const stock = view.rows.find((r) => r.key === `tagOption:${STOCK}`)!
        assert.equal(stock.currentValue, 4_000_000)
        assert.equal(stock.targetRatio, 50)
        const excluded = view.rows.find((r) => r.key === EXCLUDED_BY_CATEGORY_KEY)!
        assert.equal(excluded.isExcluded, true)
        assert.equal(excluded.currentValue, 1_500_000)
        assert.equal(view.totalValue, 8_500_000)
    })

    it("カテゴリ別の目標が無ければ従来どおり保存済みの行を使う", () => {
        const view = buildAllocationRows({
            categories: CATEGORIES,
            tagGroups: TAG_GROUPS,
            targets: [tagTarget(ASSET_CLASS, STOCK, 60), tagTarget(ASSET_CLASS, BOND, 30), tagTarget(ASSET_CLASS, CASH, 10)],
            axis: { kind: "tagGroup", tagGroupId: ASSET_CLASS },
        })
        assert.equal(view.derived, false)
        assert.equal(view.rows.find((r) => r.key === `tagOption:${STOCK}`)?.targetRatio, 60)
        assert.equal(view.rows.find((r) => r.key === "unassigned")?.targetRatio, null)
    })
})

describe("rescaleCategoryTargets", () => {
    it("選択肢の比率を変えると、属するカテゴリの目標を比例で調整する（未分類は固定）", () => {
        const result = rescaleCategoryTargets({
            categories: CATEGORIES,
            targets: CATEGORY_TARGETS,
            tagGroupId: ASSET_CLASS,
            ratios: new Map([[STOCK, 50], [BOND, 35], [CASH, 10]]),
        })!
        const byId = new Map(result.map((r) => [r.categoryId, r.ratio]))
        assert.equal(byId.get(1), 36.4)
        assert.equal(byId.get(2), 13.6)
        assert.equal(byId.get(3), 23.3)
        assert.equal(byId.get(4), 11.7)
        assert.equal(byId.get(5), 10)
        assert.equal(byId.get(6), 5)
        assert.equal(result.reduce((sum, r) => sum + r.ratio, 0), 100)
    })

    it("属するカテゴリの目標が全部0の選択肢を増やすと、その選択肢のカテゴリに配分する", () => {
        const targets = [categoryTarget(1, 60), categoryTarget(2, 20), categoryTarget(3, 0), categoryTarget(4, 0), categoryTarget(5, 20), categoryTarget(6, 0)]
        const result = rescaleCategoryTargets({
            categories: CATEGORIES,
            targets,
            tagGroupId: ASSET_CLASS,
            ratios: new Map([[STOCK, 60], [BOND, 20], [CASH, 20]]),
        })!
        const byId = new Map(result.map((r) => [r.categoryId, r.ratio]))
        // 債券20は先進国債券・国内債券へ評価額の比（2:1）で配分される
        assert.equal(byId.get(3), 13.3)
        assert.equal(byId.get(4), 6.7)
        assert.equal(byId.get(1), 45)
        assert.equal(byId.get(2), 15)
    })

    it("除外したカテゴリは触らない", () => {
        const targets = [categoryTarget(1, 50), categoryTarget(2, 20), categoryTarget(3, 30), categoryTarget(4, 0), categoryTarget(6, 0), categoryTarget(5, 0, true)]
        const result = rescaleCategoryTargets({
            categories: CATEGORIES,
            targets,
            tagGroupId: ASSET_CLASS,
            ratios: new Map([[STOCK, 60], [BOND, 40]]),
        })!
        assert.equal(result.some((r) => r.categoryId === 5), false)
        assert.equal(result.find((r) => r.categoryId === 3)?.ratio, 40)
    })
})

describe("checkTagAxisCompatibility", () => {
    const assetClassTargets = [
        tagTarget(ASSET_CLASS, STOCK, 55),
        tagTarget(ASSET_CLASS, BOND, 30),
        tagTarget(ASSET_CLASS, CASH, 15),
        tagTarget(ASSET_CLASS, null, 0, true),
    ]

    it("米ドル建ての資産は株式・債券にしか無いので、米ドル 85% までは両立する", () => {
        const result = checkTagAxisCompatibility({
            categories: CATEGORIES,
            tagGroups: TAG_GROUPS,
            targets: assetClassTargets,
            input: {
                tagGroupId: CURRENCY,
                items: [{ key: USD, ratio: 85, excluded: false }, { key: JPY, ratio: 15, excluded: false }, { key: null, ratio: 0, excluded: true }],
            },
        })
        assert.deepEqual(result, { compatible: true, conflictingGroups: [] })
    })

    it("米ドル 90% は資産クラス別の目標と両立しない", () => {
        const result = checkTagAxisCompatibility({
            categories: CATEGORIES,
            tagGroups: TAG_GROUPS,
            targets: assetClassTargets,
            input: {
                tagGroupId: CURRENCY,
                items: [{ key: USD, ratio: 90, excluded: false }, { key: JPY, ratio: 10, excluded: false }, { key: null, ratio: 0, excluded: true }],
            },
        })
        assert.deepEqual(result, { compatible: false, conflictingGroups: ["資産クラス"] })
    })

    it("他の軸に目標が無ければ常に両立する", () => {
        const result = checkTagAxisCompatibility({
            categories: CATEGORIES,
            tagGroups: TAG_GROUPS,
            targets: [],
            input: { tagGroupId: CURRENCY, items: [{ key: USD, ratio: 100, excluded: false }] },
        })
        assert.equal(result.compatible, true)
    })
})

describe("computeOptionBounds", () => {
    it("他の軸の目標から、選択肢の上限と下限を求める", () => {
        const bounds = computeOptionBounds({
            categories: CATEGORIES,
            tagGroups: TAG_GROUPS,
            targets: [tagTarget(ASSET_CLASS, STOCK, 55), tagTarget(ASSET_CLASS, BOND, 30), tagTarget(ASSET_CLASS, CASH, 15)],
            tagGroupId: CURRENCY,
        })
        const usd = bounds.get(USD)!
        assert.equal(usd.max, 85)
        assert.equal(usd.min, 0)
        assert.deepEqual(usd.maxSource?.parts, [{ name: "株式", ratio: 55 }, { name: "債券", ratio: 30 }])
        const jpy = bounds.get(JPY)!
        assert.equal(jpy.max, 100)
        // 現金は円建てしか無いので、円は最低でも 15%
        assert.equal(jpy.min, 15)
        assert.deepEqual(jpy.minSource?.parts, [{ name: "現金", ratio: 15 }])
    })
})

describe("fitCategoryTargetsToTagTargets", () => {
    it("タグ軸の目標をすべて満たすカテゴリ配分を、現在の評価額に近い形で作る", () => {
        // タグ軸の目標は合計100%なので、タグ未設定の暗号資産は 0% になる
        const targets = [
            tagTarget(ASSET_CLASS, STOCK, 55),
            tagTarget(ASSET_CLASS, BOND, 30),
            tagTarget(ASSET_CLASS, CASH, 15),
            tagTarget(CURRENCY, USD, 60),
            tagTarget(CURRENCY, JPY, 40),
        ]
        const result = fitCategoryTargetsToTagTargets({ categories: CATEGORIES, tagGroups: TAG_GROUPS, targets })!
        assert.equal(result.find((r) => r.categoryId === 6)?.ratio, 0)
        assert.equal(result.reduce((sum, r) => sum + r.ratio, 0), 100)
        const derivedAsset = deriveTagTargets(CATEGORIES, categoryTargetsOf(result.map((r) => categoryTarget(r.categoryId, r.ratio))), ASSET_CLASS)
        const derivedCurrency = deriveTagTargets(CATEGORIES, categoryTargetsOf(result.map((r) => categoryTarget(r.categoryId, r.ratio))), CURRENCY)
        const assetMap = ratioMap(derivedAsset)
        const currencyMap = ratioMap(derivedCurrency)
        for (const [key, expected] of [[STOCK, 55], [BOND, 30], [CASH, 15]] as const) {
            assert.ok(Math.abs((assetMap.get(key) as number) - expected) <= 0.15, `${key}: ${assetMap.get(key)}`)
        }
        for (const [key, expected] of [[USD, 60], [JPY, 40]] as const) {
            assert.ok(Math.abs((currencyMap.get(key) as number) - expected) <= 0.15, `${key}: ${currencyMap.get(key)}`)
        }
    })

    it("両立しない目標には null を返す", () => {
        const targets = [
            tagTarget(ASSET_CLASS, STOCK, 55),
            tagTarget(ASSET_CLASS, BOND, 30),
            tagTarget(ASSET_CLASS, CASH, 15),
            tagTarget(CURRENCY, USD, 90),
            tagTarget(CURRENCY, JPY, 10),
        ]
        assert.equal(fitCategoryTargetsToTagTargets({ categories: CATEGORIES, tagGroups: TAG_GROUPS, targets }), null)
    })
})

describe("findTagMismatches", () => {
    it("入力中のカテゴリ別の内容と、保存済みのタグ別の目標の食い違いを列挙する", () => {
        const stored = [
            tagTarget(ASSET_CLASS, STOCK, 55),
            tagTarget(ASSET_CLASS, BOND, 30),
            tagTarget(ASSET_CLASS, CASH, 10),
            tagTarget(CURRENCY, USD, 60),
            tagTarget(CURRENCY, JPY, 35),
        ]
        const entered = categoryTargetsOf([
            categoryTarget(1, 42), categoryTarget(2, 15), categoryTarget(3, 18),
            categoryTarget(4, 10), categoryTarget(5, 10), categoryTarget(6, 5),
        ])
        const mismatches = findTagMismatches({ categories: CATEGORIES, tagGroups: TAG_GROUPS, targets: stored, categoryTargets: entered })
        assert.deepEqual(
            mismatches.map((m) => [m.groupName, m.name, m.derived, m.stored]),
            [["資産クラス", "株式", 57, 55], ["資産クラス", "債券", 28, 30], ["資産クラス", "未分類", 5, null], ["通貨", "未分類", 5, null]],
        )
    })

    it("一致していれば空", () => {
        const stored = [tagTarget(CURRENCY, USD, 60), tagTarget(CURRENCY, JPY, 35), tagTarget(CURRENCY, null, 0, true)]
        const mismatches = findTagMismatches({ categories: CATEGORIES, tagGroups: TAG_GROUPS, targets: stored, categoryTargets: categoryTargetsOf(CATEGORY_TARGETS) })
        // 未分類は保存側で除外しているが、カテゴリ別では暗号資産に目標5%がある
        assert.deepEqual(mismatches.map((m) => [m.name, m.derived, m.stored]), [["未分類", 5, null]])

        const matched = findTagMismatches({
            categories: CATEGORIES,
            tagGroups: TAG_GROUPS,
            targets: [tagTarget(CURRENCY, USD, 60), tagTarget(CURRENCY, JPY, 35)],
            categoryTargets: categoryTargetsOf(CATEGORY_TARGETS),
        })
        // 未分類は保存側で目標を持てない（0扱い）ので、算出値5%とは食い違う
        assert.deepEqual(matched.map((m) => [m.name, m.derived, m.stored]), [["未分類", 5, null]])
    })
})

describe("findStoredConflicts", () => {
    it("保存済みのタグ軸同士が両立しなければ、その組み合わせを返す", () => {
        const targets = [
            tagTarget(ASSET_CLASS, STOCK, 55),
            tagTarget(ASSET_CLASS, BOND, 30),
            tagTarget(ASSET_CLASS, CASH, 15),
            tagTarget(CURRENCY, USD, 90),
            tagTarget(CURRENCY, JPY, 10),
        ]
        const conflicts = findStoredConflicts({ categories: CATEGORIES, tagGroups: TAG_GROUPS, targets })
        assert.equal(conflicts.length, 1)
        assert.deepEqual(conflicts[0].conflictingGroups.length, 1)
    })

    it("カテゴリ別の目標があれば矛盾は起きない", () => {
        const targets = [...CATEGORY_TARGETS, tagTarget(ASSET_CLASS, STOCK, 100), tagTarget(CURRENCY, JPY, 100)]
        assert.deepEqual(findStoredConflicts({ categories: CATEGORIES, tagGroups: TAG_GROUPS, targets }), [])
    })
})

describe("roundToHundred", () => {
    it("小数第1位に丸めて、端数は最大の項目で吸収する", () => {
        const result = roundToHundred([{ ratio: 33.333 }, { ratio: 33.333 }, { ratio: 33.334 }])
        assert.deepEqual(result.map((r) => r.ratio), [33.3, 33.3, 33.4])
    })
})
