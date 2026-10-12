import assert from "node:assert/strict"
import { test } from "node:test"
import { FURUSATO_STATUS_FILTERS, buildFilterHref, parseYearParam, resolveStatusFilter } from "./filters"

test("未知の状態は「すべて」に落とす", () => {
    assert.equal(resolveStatusFilter("nope").key, "all")
    assert.equal(resolveStatusFilter(undefined).key, "all")
    assert.equal(resolveStatusFilter("incomplete").key, "incomplete")
})

test("絞り込みは申請・証明書の状態で一致を判定する", () => {
    const filter = (key: string) => FURUSATO_STATUS_FILTERS.find((f) => f.key === key)!
    const row = { oneStopStatus: "switchedToTaxReturn", certificateStatus: "received" } as const
    assert.equal(filter("switchedToTaxReturn").match(row), true)
    assert.equal(filter("oneStopNotApplied").match(row), false)
    assert.equal(filter("incomplete").match(row), false)
    assert.equal(filter("certificateNotReceived").match({ ...row, certificateStatus: "notReceived" }), true)
})

test("年は4桁の西暦だけを受け付け、リンクに年と状態を載せる", () => {
    assert.equal(parseYearParam("2026"), 2026)
    assert.equal(parseYearParam("26"), null)
    assert.equal(parseYearParam(undefined), null)
    assert.equal(buildFilterHref(2026, resolveStatusFilter("incomplete")), "/furusato?year=2026&status=incomplete")
    assert.equal(buildFilterHref(2026, resolveStatusFilter("all")), "/furusato?year=2026")
})
