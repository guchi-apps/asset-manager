import assert from "node:assert/strict"
import { test } from "node:test"
import { MODEL_SPECS, contentHash, normalizeRow, type NormalizedRow } from "./models"
import { checkItemReferences, countActions, planModel, type ImportRecord } from "./plan"

const salarySpec = MODEL_SPECS.salary

const salary = (id: string, overrides: Record<string, unknown> = {}): NormalizedRow =>
    normalizeRow(salarySpec, {
        id,
        userId: "source-user",
        salaryDate: "2026-01-25 00:00:00.000",
        grossSalary: "300000.00",
        netSalary: "240000.00",
        data: JSON.stringify({ baseGrossSalary: 300000, customItemValues: { item1: 5000 } }),
        memo: null,
        deletedAt: null,
        createdAt: "2026-01-25 10:00:00.000",
        updatedAt: "2026-01-25 10:00:00.000",
        ...overrides,
    })

/** 移行先で読んだ行（userId が違い、Prisma の値の形で返る） */
const asTarget = (row: NormalizedRow, fields: Record<string, unknown> = {}): NormalizedRow => ({
    ...row,
    userId: "target-user",
    fields: { ...row.fields, ...fields } as NormalizedRow["fields"],
})

const recordOf = (row: NormalizedRow): ImportRecord => ({ sourceId: row.id, targetId: row.id, contentHash: contentHash(row) })

const plan = (sourceRows: NormalizedRow[], targetRows: NormalizedRow[], records: ImportRecord[] = [], foreign: string[] = []) =>
    planModel({ spec: salarySpec, sourceRows, targetRows, records, foreignTargetIds: new Set(foreign) })

test("初回は移行元の行をすべて作成する", () => {
    const result = plan([salary("s1"), salary("s2", { salaryDate: "2026-02-25 00:00:00.000" })], [])
    assert.deepEqual(countActions(result.actions).create, 2)
    assert.equal(result.targetOnlyCount, 0)
})

test("同じ移行を2回流しても、2回目は何もしない", () => {
    const s1 = salary("s1")
    const result = plan([s1], [asTarget(s1)], [recordOf(s1)])
    assert.deepEqual(
        result.actions.map((action) => action.kind),
        ["unchanged"]
    )
})

test("切替直前に旧アプリで直した行だけを更新する", () => {
    const before = salary("s1")
    const after = salary("s1", { netSalary: "241000.00" })
    const result = plan([after], [asTarget(before)], [recordOf(before)])
    assert.equal(result.actions[0].kind, "update")
})

test("移行後に新アプリで直した行は、旧アプリの値で上書きしない", () => {
    const s1 = salary("s1")
    const result = plan([s1], [asTarget(s1, { memo: "新アプリで追記" })], [recordOf(s1)])
    assert.equal(result.actions[0].kind, "keepTarget")
})

test("旧アプリと新アプリの両方で違う内容に直した行は衝突にする", () => {
    const before = salary("s1")
    const result = plan(
        [salary("s1", { memo: "旧アプリ" })],
        [asTarget(before, { memo: "新アプリ" })],
        [recordOf(before)]
    )
    assert.equal(result.actions[0].kind, "conflict")
})

test("旧アプリで物理削除された行は、移行先が変わっていなければ消す", () => {
    const gone = salary("s1")
    assert.equal(plan([], [asTarget(gone)], [recordOf(gone)]).actions[0].kind, "delete")
    assert.equal(plan([], [asTarget(gone, { memo: "x" })], [recordOf(gone)]).actions[0].kind, "conflict")
    assert.equal(plan([], [], [recordOf(gone)]).actions[0].kind, "forgetRecord")
})

test("論理削除の状態を内容として扱う（旧アプリで削除した明細は削除済みとして更新される）", () => {
    const before = salary("s1")
    const deleted = salary("s1", { deletedAt: "2026-03-01 09:00:00.000" })
    const result = plan([deleted], [asTarget(before)], [recordOf(before)])
    assert.equal(result.actions[0].kind, "update")
})

test("移行先に同じ支給日の明細があれば、削除済みでも衝突にして既存を残す", () => {
    const existing = asTarget(salary("native", { deletedAt: "2026-02-01 00:00:00.000" }))
    const result = plan([salary("s1")], [existing])
    assert.equal(result.actions[0].kind, "conflict")
    assert.match((result.actions[0] as { reason: string }).reason, /salaryDate=2026-01-25.*native、削除済み/)
    assert.equal(result.targetOnlyCount, 1)
})

test("旧アプリで消して同じ支給日に作り直した明細は、消してから作るので衝突しない", () => {
    const old = salary("old")
    const result = plan([salary("new")], [asTarget(old)], [recordOf(old)])
    assert.deepEqual(result.actions.map((action) => action.kind).sort(), ["create", "delete"])
})

test("同じ id の行が移行先にあり、記録が無く内容が違えば衝突。同じ内容なら記録だけ付ける", () => {
    const s1 = salary("s1")
    assert.equal(plan([s1], [asTarget(s1, { memo: "違う" })]).actions[0].kind, "conflict")
    assert.equal(plan([s1], [asTarget(s1)]).actions[0].kind, "link")
})

test("同じ id を別のユーザーが持っていれば衝突にする（他ユーザーへ混ぜない）", () => {
    assert.equal(plan([salary("s1")], [], [], ["s1"]).actions[0].kind, "conflict")
})

test("移行と無関係な移行先の行を数える（触らない）", () => {
    const native = asTarget(salary("native", { salaryDate: "2026-05-25 00:00:00.000" }))
    const result = plan([salary("s1")], [native])
    assert.equal(result.targetOnlyCount, 1)
    assert.equal(result.actions[0].kind, "create")
})

test("寄付は一意キーが無いので、同じ日・同じ自治体の寄付が既にあっても衝突にしない", () => {
    const spec = MODEL_SPECS.furusatoDonation
    const donation = (id: string) =>
        normalizeRow(spec, {
            id,
            userId: "u",
            year: 2026,
            donatedAt: "2026-09-28 00:00:00.000",
            municipality: "北海道 紋別市",
            amount: "10000.00",
            oneStopStatus: "applied",
            certificateStatus: "notNeeded",
            createdAt: "2026-09-28 00:00:00.000",
            updatedAt: "2026-09-28 00:00:00.000",
        })
    const result = planModel({
        spec,
        sourceRows: [donation("d1")],
        targetRows: [donation("native")],
        records: [],
        foreignTargetIds: new Set(),
    })
    assert.equal(result.actions[0].kind, "create")
})

test("項目一覧にも写しにも無い項目の金額を警告する。削除済みの項目でも写しがあれば警告しない", () => {
    const withSnapshot = salary("s1", {
        data: JSON.stringify({ customItemValues: { gone: 100 }, itemSnapshots: { gone: { itemName: "旧手当" } } }),
    })
    const orphan = salary("s2", { data: JSON.stringify({ customItemValues: { unknown: 100, item1: 5 } }) })
    const warnings = checkItemReferences(
        [
            { model: "salary", row: withSnapshot },
            { model: "salary", row: orphan },
        ],
        new Set(["item1"])
    )
    assert.deepEqual(
        warnings.map((warning) => [warning.sourceId, warning.itemId]),
        [["s2", "unknown"]]
    )
})
