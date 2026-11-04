import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { parseCategoryImport, parseSourcePair, planCategoryImport, type ParsedCategoryImport } from "./ledger-category-import"

const file = (categories: unknown) => JSON.stringify({ provider: "zaim", categories })

describe("parseSourcePair", () => {
    it("最初の「/」でカテゴリと内訳に分け、内訳が無い・「-」なら内訳を問わない", () => {
        assert.deepEqual(parseSourcePair("食費/食料品"), { category: "食費", genre: "食料品" })
        assert.deepEqual(parseSourcePair("給料"), { category: "給料", genre: "" })
        assert.deepEqual(parseSourcePair("給料/-"), { category: "給料", genre: "" })
        assert.deepEqual(parseSourcePair(" 雑費 / 立替 "), { category: "雑費", genre: "立替" })
        assert.equal(parseSourcePair("/食料品"), null)
        assert.equal(parseSourcePair(3), null)
    })
})

describe("parseCategoryImport", () => {
    it("読めないJSON・空の一覧は誤りにする", () => {
        assert.deepEqual(parseCategoryImport("{"), { ok: false, errors: ["JSONとして読めません"] })
        assert.equal(parseCategoryImport(file([])).ok, false)
    })

    it("誤りはまとめて返す", () => {
        const result = parseCategoryImport(
            file([
                { name: "食費", kind: "EXPENSE", children: [{ name: "外食", from: ["食費/外食"] }, { name: "外食" }] },
                { name: "", kind: "EXPENSE" },
                { name: "収入", kind: "INCOME?" },
                { name: "交際費", kind: "EXPENSE", children: [{ name: "食事", from: ["食費/外食"], children: [] }] },
            ])
        )
        assert.equal(result.ok, false)
        if (result.ok) return
        assert.deepEqual(result.errors, [
            "食費: 中分類「外食」が2回あります",
            "2番目の大分類に名前がありません",
            "収入: kind は EXPENSE（支出）か INCOME（収入）で書いてください",
            "交際費/食事: 中分類の下にはカテゴリを作れません",
            "「食費/外食」が 食費/外食 と 交際費/食事 の両方にあります",
        ])
    })

    it("同じ名前でも支出と収入は別の大分類", () => {
        const result = parseCategoryImport(
            file([
                { name: "その他", kind: "EXPENSE", children: [{ name: "その他" }] },
                { name: "その他", kind: "INCOME", from: ["その他収入"] },
            ])
        )
        assert.equal(result.ok, true)
    })
})

describe("planCategoryImport", () => {
    const parsed: ParsedCategoryImport = {
        provider: "zaim",
        categories: [
            {
                name: "食費",
                kind: "EXPENSE",
                from: [],
                workRelated: false,
                children: [
                    { name: "食料品", from: [{ category: "食費", genre: "食料品" }, { category: "食費", genre: "" }], workRelated: false },
                    { name: "外食", from: [{ category: "食費", genre: "外食" }], workRelated: false },
                ],
            },
            {
                name: "収入",
                kind: "INCOME",
                from: [],
                workRelated: false,
                children: [{ name: "給与", from: [{ category: "給料", genre: "" }], workRelated: false }],
            },
        ],
    }

    it("何も無ければ全部作り、親は先に作ったものを指す", () => {
        const plan = planCategoryImport(parsed, [], [])
        assert.deepEqual(
            plan.creates.map((c) => [c.label, c.kind, c.parent]),
            [
                ["食費", "EXPENSE", null],
                ["食費/食料品", "EXPENSE", { newIndex: 0 }],
                ["食費/外食", "EXPENSE", { newIndex: 0 }],
                ["収入", "INCOME", null],
                ["収入/給与", "INCOME", { newIndex: 3 }],
            ]
        )
        assert.deepEqual(
            plan.mappings.map((m) => [m.targetLabel, m.target, m.status]),
            [
                ["食費/食料品", { newIndex: 1 }, "new"],
                ["食費/食料品", { newIndex: 1 }, "new"],
                ["食費/外食", { newIndex: 2 }, "new"],
                ["収入/給与", { newIndex: 4 }, "new"],
            ]
        )
    })

    it("既にあるカテゴリは名前で突き合わせて作らず、対応の変化を見分ける", () => {
        const existing = [
            { id: 1, name: "食費", kind: "EXPENSE" as const, parentId: null },
            { id: 2, name: "外食", kind: "EXPENSE" as const, parentId: 1 },
            { id: 3, name: "外食", kind: "EXPENSE" as const, parentId: null }, // 大分類の同名は別物
            { id: 9, name: "収入", kind: "EXPENSE" as const, parentId: null }, // 支出の「収入」は別物
        ]
        const mappings = [
            { externalCategory: "食費", externalGenre: "外食", categoryId: 2 },
            { externalCategory: "給料", externalGenre: "", categoryId: 3 },
            { externalCategory: "交際費", externalGenre: "", categoryId: 3 },
        ]
        const plan = planCategoryImport(parsed, existing, mappings)
        assert.equal(plan.existingCount, 2)
        assert.deepEqual(
            plan.creates.map((c) => [c.label, c.parent]),
            [
                ["食費/食料品", { id: 1 }],
                ["収入", null],
                ["収入/給与", { newIndex: 1 }],
            ]
        )
        const byLabel = Object.fromEntries(plan.mappings.map((m) => [`${m.pair.category}/${m.pair.genre}`, [m.status, m.previousLabel]]))
        assert.deepEqual(byLabel["食費/外食"], ["same", null])
        assert.deepEqual(byLabel["給料/"], ["changed", "外食"])
        assert.equal(plan.untouchedMappings, 1)
    })
})

describe("会社関係（work）", () => {
    it("作るカテゴリにも、既にあるカテゴリにも付ける（外しはしない）", () => {
        const parsed = parseCategoryImport(
            file([
                { name: "会社経費", kind: "EXPENSE", work: true, children: [{ name: "出張" }] },
                { name: "交通・車", kind: "EXPENSE", children: [{ name: "通勤", work: true }, { name: "ガソリン" }] },
            ])
        )
        assert.equal(parsed.ok, true)
        if (!parsed.ok) return
        const plan = planCategoryImport(
            parsed.value,
            [
                { id: 1, name: "交通・車", kind: "EXPENSE", parentId: null, workRelated: false },
                { id: 2, name: "通勤", kind: "EXPENSE", parentId: 1, workRelated: false },
                { id: 3, name: "ガソリン", kind: "EXPENSE", parentId: 1, workRelated: true },
            ],
            []
        )
        assert.deepEqual(
            plan.creates.map((c) => [c.label, c.workRelated]),
            [
                ["会社経費", true],
                ["会社経費/出張", false],
            ]
        )
        assert.deepEqual(plan.workUpdates, [{ id: 2, label: "交通・車/通勤" }])
    })
})

describe("おすすめの体系（lib/ledger-category-presets/zaim.json）", () => {
    it("読めて、中分類は2階層までに収まる", () => {
        const result = parseCategoryImport(readFileSync(new URL("./ledger-category-presets/zaim.json", import.meta.url), "utf-8"))
        assert.equal(result.ok, true, result.ok ? "" : result.errors.join("\n"))
        if (!result.ok) return
        assert.equal(result.value.categories.filter((c) => c.kind === "EXPENSE").length, 12)
        assert.deepEqual(
            result.value.categories.find((c) => c.kind === "INCOME")?.children.map((c) => c.name),
            ["給与", "賞与", "精算", "利息・還元", "その他"]
        )
        const work = result.value.categories.flatMap((c) => [
            ...(c.workRelated ? [c.name] : []),
            ...c.children.filter((child) => child.workRelated).map((child) => `${c.name}/${child.name}`),
        ])
        assert.deepEqual(work, ["交通・車/通勤", "会社経費", "収入/精算"])
    })
})
