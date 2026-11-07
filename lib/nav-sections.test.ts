import assert from "node:assert/strict"
import { test } from "node:test"
import { ANALYSIS_TABS, ASSETS_TABS, PAYROLL_TABS, SETTINGS_TABS, resolveActiveTab, resolveMainMenu, resolveSectionTabs } from "./nav-sections"

test("既存URLが対応する親メニューへ解決される", () => {
    const cases: [string, string | null][] = [
        ["/", "home"],
        ["/ledger", "ledger"],
        ["/assets", "assets"],
        ["/assets/12", "assets"],
        ["/assets/settings", "assets"],
        ["/assets/groups", "assets"],
        // レシートはメニューから外し、家計簿の配下（Issue #912）
        ["/receipts", "ledger"],
        ["/receipts/3", "ledger"],
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
        ["/household", "analysis"],
        ["/monthly", "analysis"],
        ["/base-date", "analysis"],
        ["/rebalance", "analysis"],
        ["/indices", "analysis"],
        ["/settings", "settings"],
        ["/settings/general", "settings"],
        ["/profile", "settings"],
        ["/data-fetch", "dataFetch"],
        ["/data-management", "settings"],
        ["/unknown", null],
    ]
    for (const [path, expected] of cases) assert.equal(resolveMainMenu(path), expected, path)
})

test("共通タブは分析・給与・設定・投資資産の配下に出る（設定一覧・資産の詳細は除く）", () => {
    assert.equal(resolveSectionTabs("/monthly"), ANALYSIS_TABS)
    assert.equal(resolveSectionTabs("/household"), ANALYSIS_TABS)
    assert.equal(resolveSectionTabs("/data-fetch"), null)
    assert.equal(resolveSectionTabs("/settings/general"), SETTINGS_TABS)
    assert.equal(resolveSectionTabs("/settings"), null)
    assert.equal(resolveSectionTabs("/salaries"), PAYROLL_TABS)
    assert.equal(resolveSectionTabs("/bonuses/new"), PAYROLL_TABS)
    assert.equal(resolveSectionTabs("/assets"), ASSETS_TABS)
    assert.equal(resolveSectionTabs("/assets/settings"), ASSETS_TABS)
    assert.equal(resolveSectionTabs("/assets/groups"), ASSETS_TABS)
    assert.equal(resolveSectionTabs("/assets/12"), null)
})

test("選択中のタブを返す", () => {
    assert.equal(resolveActiveTab("/rebalance", ANALYSIS_TABS), "/rebalance")
    assert.equal(resolveActiveTab("/settings/general", SETTINGS_TABS), "/settings/general")
    assert.equal(resolveActiveTab("/salaries/settings", PAYROLL_TABS), "/salaries/settings")
    assert.equal(resolveActiveTab("/salaries/abc/edit", PAYROLL_TABS), "/salaries")
    assert.equal(resolveActiveTab("/bonuses/new", PAYROLL_TABS), "/bonuses")
    assert.equal(resolveActiveTab("/tax", PAYROLL_TABS), "/tax")
    assert.equal(resolveActiveTab("/assets", ASSETS_TABS), "/assets")
    assert.equal(resolveActiveTab("/assets/settings", ASSETS_TABS), "/assets/settings")
})
