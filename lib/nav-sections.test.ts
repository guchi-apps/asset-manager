import assert from "node:assert/strict"
import { test } from "node:test"
import { ANALYSIS_TABS, PAYROLL_TABS, SETTINGS_TABS, resolveActiveTab, resolveMainMenu, resolveSectionTabs } from "./nav-sections"

test("既存URLが対応する親メニューへ解決される", () => {
    const cases: [string, string | null][] = [
        ["/", "home"],
        ["/assets", "assets"],
        ["/assets/12", "assets"],
        ["/receipts", "receipts"],
        ["/receipts/3", "receipts"],
        ["/subscriptions", "subscriptions"],
        ["/salaries", "payroll"],
        ["/salaries/new", "payroll"],
        ["/salaries/abc/edit", "payroll"],
        ["/salaries/settings", "payroll"],
        ["/bonuses", "payroll"],
        ["/bonuses/new", "payroll"],
        ["/furusato", "payroll"],
        ["/furusato/new", "payroll"],
        ["/furusato/abc/edit", "payroll"],
        ["/tax", "payroll"],
        ["/monthly", "analysis"],
        ["/base-date", "analysis"],
        ["/rebalance", "analysis"],
        ["/indices", "analysis"],
        ["/settings", "settings"],
        ["/settings/general", "settings"],
        ["/profile", "settings"],
        ["/data-fetch", "settings"],
        ["/data-management", "settings"],
        ["/unknown", null],
    ]
    for (const [path, expected] of cases) assert.equal(resolveMainMenu(path), expected, path)
})

test("共通タブは分析・給与・設定配下だけに出る（設定一覧は除く）", () => {
    assert.equal(resolveSectionTabs("/monthly"), ANALYSIS_TABS)
    assert.equal(resolveSectionTabs("/data-fetch"), SETTINGS_TABS)
    assert.equal(resolveSectionTabs("/settings/general"), SETTINGS_TABS)
    assert.equal(resolveSectionTabs("/settings"), null)
    assert.equal(resolveSectionTabs("/salaries"), PAYROLL_TABS)
    assert.equal(resolveSectionTabs("/bonuses/new"), PAYROLL_TABS)
    assert.equal(resolveSectionTabs("/assets"), null)
})

test("選択中のタブを返す", () => {
    assert.equal(resolveActiveTab("/rebalance", ANALYSIS_TABS), "/rebalance")
    assert.equal(resolveActiveTab("/settings/general", SETTINGS_TABS), "/settings/general")
    assert.equal(resolveActiveTab("/salaries/settings", PAYROLL_TABS), "/salaries/settings")
    assert.equal(resolveActiveTab("/salaries/abc/edit", PAYROLL_TABS), "/salaries")
    assert.equal(resolveActiveTab("/bonuses/new", PAYROLL_TABS), "/bonuses")
    assert.equal(resolveActiveTab("/tax", PAYROLL_TABS), "/tax")
})
