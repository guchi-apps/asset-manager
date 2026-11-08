import assert from "node:assert/strict"
import { test } from "node:test"
import { buildPayrollYearlyRows, mergePayrollEntries } from "./combined"
import type { BonusDTO, SalaryDTO } from "./types"

function salary(id: string, date: string, gross: number, net: number): SalaryDTO {
    return {
        id, userId: "u", salaryDate: date, grossSalary: String(gross), netSalary: String(net),
        data: {}, memo: null, createdAt: date, updatedAt: date, deletedAt: null,
    }
}

function bonus(id: string, date: string, amount: number, net: number): BonusDTO {
    return {
        id, userId: "u", bonusDate: date, amount: String(amount),
        data: { netAmount: net }, memo: null, createdAt: date, updatedAt: date, deletedAt: null,
    }
}

test("給与と賞与を支給日の新しい順に合算し、同じ日は給与を先にする", () => {
    const entries = mergePayrollEntries(
        [salary("s1", "2026-06-25T03:00:00.000Z", 400, 300), salary("s2", "2026-07-25T03:00:00.000Z", 410, 310)],
        [bonus("b1", "2026-06-25T03:00:00.000Z", 800, 600), bonus("b2", "2026-12-10T03:00:00.000Z", 900, 700)]
    )
    assert.deepEqual(entries.map((e) => e.id), ["b2", "s2", "s1", "b1"])
    assert.equal(entries[0].kind, "bonus")
    assert.equal(entries[0].net, 700)
})

test("年別は同じ年の給与と賞与を合算し、手取り額も合計する", () => {
    const rows = buildPayrollYearlyRows(
        [salary("s1", "2025-06-25T03:00:00.000Z", 400, 300), salary("s2", "2026-01-25T03:00:00.000Z", 410, 310), salary("s3", "2026-02-25T03:00:00.000Z", 410, 310)],
        [bonus("b1", "2026-06-25T03:00:00.000Z", 800, 600)]
    )
    assert.equal(rows.length, 2)
    assert.deepEqual(rows[0].values, { 給与: 400, 賞与: 0, 手取り額: 300 })
    assert.deepEqual(rows[1].values, { 給与: 820, 賞与: 800, 手取り額: 1220 })
})
