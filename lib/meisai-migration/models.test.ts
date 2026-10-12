import assert from "node:assert/strict"
import { test } from "node:test"
import { mapAccounts } from "./accounts"
import { MODEL_SPECS, canonicalDate, canonicalDecimal, contentHash, normalizeRow } from "./models"
import { diffTotals, formatMinorUnits, totalsByYear } from "./reconcile"

test("Decimal は移行元の文字列と移行先の Decimal を同じ文字列にそろえる", () => {
    assert.equal(canonicalDecimal("300000.00", 2), "300000.00")
    assert.equal(canonicalDecimal("-12000.5", 2), "-12000.50")
    assert.equal(canonicalDecimal("9.15", 4), "9.1500")
    assert.equal(canonicalDecimal({ toFixed: (dp: number) => (9.15).toFixed(dp) }, 4), "9.1500")
    assert.equal(canonicalDecimal("-0.00", 2), "0.00")
    assert.throws(() => canonicalDecimal("1.234", 2), /2桁/)
})

test("日時は移行元の文字列（UTC）と移行先の Date を同じ ISO8601 にそろえる", () => {
    assert.equal(canonicalDate("2026-01-25 00:00:00.000"), "2026-01-25T00:00:00.000Z")
    assert.equal(canonicalDate("2026-01-25 09:30:00"), "2026-01-25T09:30:00.000Z")
    assert.equal(canonicalDate(new Date("2026-01-25T00:00:00Z")), "2026-01-25T00:00:00.000Z")
})

test("移行元（mysql2）と移行先（Prisma）で読んだ同じ行は、同じハッシュになる", () => {
    const spec = MODEL_SPECS.payItem
    const source = normalizeRow(spec, {
        id: "i1",
        userId: "meisai-user",
        itemName: "通勤手当",
        itemType: "otherEarning",
        scope: "salary",
        isTaxable: 0,
        displayOrder: 3,
        isActive: 1,
        createdAt: "2026-01-01 00:00:00.000",
        updatedAt: "2026-01-02 00:00:00.000",
    })
    const target = normalizeRow(spec, {
        id: "i1",
        userId: "asset-user",
        itemName: "通勤手当",
        itemType: "otherEarning",
        scope: "salary",
        isTaxable: false,
        displayOrder: 3,
        isActive: true,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-05-02T00:00:00Z"),
    })
    // userId・更新日時は内容に含めない
    assert.equal(contentHash(source), contentHash(target))
})

test("JSON はキーの順序が違っても同じハッシュになり、MariaDB の文字列でも読める", () => {
    const spec = MODEL_SPECS.bonus
    const base = { id: "b1", userId: "u", bonusDate: "2026-06-30 00:00:00.000", amount: "500000.00", memo: null, deletedAt: null, createdAt: "2026-06-30 00:00:00.000", updatedAt: "2026-06-30 00:00:00.000" }
    const a = normalizeRow(spec, { ...base, data: JSON.stringify({ netAmount: 400000, customItemValues: { x: 1, y: 2 } }) })
    const b = normalizeRow(spec, { ...base, data: { customItemValues: { y: 2, x: 1 }, netAmount: 400000 } })
    assert.equal(contentHash(a), contentHash(b))
})

test("アカウントは supabaseUserId とメールの両方が一致したときだけ対応付ける", () => {
    const targets = [
        { id: "am1", email: "me@example.com", supabaseUserId: "sb1" },
        { id: "am2", email: "other@example.com", supabaseUserId: "sb2" },
    ]
    const [ok, emailOnly, supabaseOnly, missing, noSupabase] = mapAccounts(
        [
            { id: "m1", email: "ME@example.com", supabaseUserId: "sb1" },
            { id: "m2", email: "other@example.com", supabaseUserId: "sb-old" },
            { id: "m3", email: "changed@example.com", supabaseUserId: "sb2" },
            { id: "m4", email: "nobody@example.com", supabaseUserId: "sb9" },
            { id: "m5", email: "me@example.com", supabaseUserId: null },
        ],
        targets
    )
    assert.equal(ok.status === "mapped" && ok.target.id, "am1")
    assert.match(emailOnly.status === "unmapped" ? emailOnly.reason : "", /作り直された/)
    assert.match(supabaseOnly.status === "unmapped" ? supabaseOnly.reason : "", /メールアドレスが違います/)
    assert.match(missing.status === "unmapped" ? missing.reason : "", /いません/)
    assert.match(noSupabase.status === "unmapped" ? noSupabase.reason : "", /supabaseUserId がありません/)
})

test("明示の対応付けもメールの一致を求め、2人が同じ移行先へ向かえばどちらも対応不明にする", () => {
    const targets = [{ id: "am1", email: "me@example.com", supabaseUserId: "sb-new" }]
    const [viaExplicit] = mapAccounts([{ id: "m1", email: "me@example.com", supabaseUserId: "sb-old" }], targets, { m1: "am1" })
    assert.equal(viaExplicit.status === "mapped" && viaExplicit.via, "explicit")
    const [wrongEmail] = mapAccounts([{ id: "m1", email: "x@example.com", supabaseUserId: null }], targets, { m1: "am1" })
    assert.equal(wrongEmail.status, "unmapped")

    const both = mapAccounts(
        [
            { id: "m1", email: "me@example.com", supabaseUserId: "sb-new" },
            { id: "m2", email: "me@example.com", supabaseUserId: "sb-old" },
        ],
        targets,
        { m2: "am1" }
    )
    assert.deepEqual(
        both.map((mapping) => mapping.status),
        ["unmapped", "unmapped"]
    )
})

test("照合はユーザー×年で件数・削除済み件数・金額（最小単位）を突き合わせる", () => {
    const spec = MODEL_SPECS.salary
    const row = (id: string, date: string, gross: string, deletedAt: string | null = null) =>
        normalizeRow(spec, {
            id,
            userId: "u",
            salaryDate: date,
            grossSalary: gross,
            netSalary: "0.10",
            data: "{}",
            memo: null,
            deletedAt,
            createdAt: date,
            updatedAt: date,
        })
    const source = [
        row("a", "2025-12-25 00:00:00", "0.10"),
        row("b", "2026-01-25 00:00:00", "0.20"),
        row("c", "2026-02-25 00:00:00", "999.99", "2026-03-01 00:00:00"),
    ]
    const totals = totalsByYear(spec, source)
    assert.deepEqual(totals.get("2026"), {
        count: 1,
        deletedCount: 1,
        amounts: { grossSalary: "20", netSalary: "10" },
    })
    assert.deepEqual(diffTotals(spec, totals, totalsByYear(spec, source)), [])
    const missingDeleted = diffTotals(spec, totals, totalsByYear(spec, source.slice(0, 2)))
    assert.deepEqual(
        missingDeleted.map((diff) => diff.year),
        ["2026"]
    )
    assert.equal(formatMinorUnits("-123456789"), "-1,234,567.89")
})
