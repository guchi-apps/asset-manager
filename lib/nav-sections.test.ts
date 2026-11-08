import assert from "node:assert/strict"
import { test } from "node:test"
import { ANALYSIS_TABS, ASSETS_TABS, PAYROLL_TABS, TAX_TABS, resolveActiveTab, resolveMainMenu, resolveSectionTabs, resolveSettingsHref } from "./nav-sections"

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
        // ふるさと納税・税務確認は「税金」（Issue #993）
        ["/furusato", "tax"],
        ["/furusato/new", "tax"],
        ["/furusato/abc/edit", "tax"],
        ["/tax", "tax"],
        ["/household", "analysis"],
        ["/monthly", "analysis"],
        ["/base-date", "analysis"],
        ["/rebalance", "analysis"],
        ["/indices", "analysis"],
        ["/ledger/settings", "ledger"],
        ["/settings", null],
        ["/data-fetch", "dataFetch"],
        ["/unknown", null],
    ]
    for (const [path, expected] of cases) assert.equal(resolveMainMenu(path), expected, path)
})

test("共通タブは分析・給与・設定・投資資産の配下に出る（設定一覧・資産の詳細は除く）", () => {
    assert.equal(resolveSectionTabs("/monthly"), ANALYSIS_TABS)
    assert.equal(resolveSectionTabs("/household"), ANALYSIS_TABS)
    assert.equal(resolveSectionTabs("/data-fetch"), null)
    assert.equal(resolveSectionTabs("/salaries"), PAYROLL_TABS)
    assert.equal(resolveSectionTabs("/bonuses/new"), PAYROLL_TABS)
    assert.equal(resolveSectionTabs("/furusato"), TAX_TABS)
    assert.equal(resolveSectionTabs("/tax"), TAX_TABS)
    assert.equal(resolveSectionTabs("/assets"), ASSETS_TABS)
    assert.equal(resolveSectionTabs("/assets/settings"), ASSETS_TABS)
    assert.equal(resolveSectionTabs("/assets/groups"), ASSETS_TABS)
    assert.equal(resolveSectionTabs("/assets/12"), null)
})

test("選択中のタブを返す", () => {
    assert.equal(resolveActiveTab("/rebalance", ANALYSIS_TABS), "/rebalance")
    assert.equal(resolveActiveTab("/salaries/settings", PAYROLL_TABS), "/salaries/settings")
    assert.equal(resolveActiveTab("/salaries/abc/edit", PAYROLL_TABS), "/salaries")
    // 賞与の登録・編集はタブに無いため、選択中のタブは無い（Issue #1182）
    assert.equal(resolveActiveTab("/bonuses/new", PAYROLL_TABS), null)
    assert.equal(resolveActiveTab("/tax", TAX_TABS), "/tax")
    assert.equal(resolveActiveTab("/furusato/new", TAX_TABS), "/furusato")
    assert.equal(resolveActiveTab("/assets", ASSETS_TABS), "/assets")
    assert.equal(resolveActiveTab("/assets/settings", ASSETS_TABS), "/assets/settings")
})

test("歯車の行き先は設定を持つ区分だけに出る（Issue #1003）", () => {
    const cases: [string, string | null][] = [
        ["/", "/assets/settings"],
        ["/assets", "/assets/settings"],
        ["/assets/12", "/assets/settings"],
        ["/ledger", "/ledger/settings"],
        ["/receipts", "/ledger/settings"],
        ["/salaries", "/salaries/settings"],
        ["/bonuses", "/salaries/settings"],
        ["/tax", null],
        ["/household", null],
        ["/subscriptions", null],
        ["/data-fetch", null],
    ]
    for (const [path, expected] of cases) assert.equal(resolveSettingsHref(path), expected, path)
})
