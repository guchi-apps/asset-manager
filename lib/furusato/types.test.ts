import assert from "node:assert/strict"
import { test } from "node:test"

import { PORTAL_SITES, PORTAL_SITE_OTHER, fromPortalSiteChoice, toPortalSiteChoice } from "./types"

test("利用サイトの候補に Amazon が含まれる", () => {
    assert.ok(PORTAL_SITES.includes("Amazon"))
})

test("未設定は未選択になり、空文字で保存される", () => {
    assert.deepEqual(toPortalSiteChoice(null), { select: "", custom: "" })
    assert.deepEqual(toPortalSiteChoice("  "), { select: "", custom: "" })
    assert.equal(fromPortalSiteChoice({ select: "", custom: "" }), "")
})

test("候補にあるサイト名はそのまま選択状態になる", () => {
    assert.deepEqual(toPortalSiteChoice("さとふる"), { select: "さとふる", custom: "" })
    assert.equal(fromPortalSiteChoice({ select: "Amazon", custom: "無視される" }), "Amazon")
})

test("候補に無い既存値は「その他」＋自由入力になり、値を失わない", () => {
    const choice = toPortalSiteChoice("ふるさとプレミアム")
    assert.deepEqual(choice, { select: PORTAL_SITE_OTHER, custom: "ふるさとプレミアム" })
    assert.equal(fromPortalSiteChoice(choice), "ふるさとプレミアム")
})

test("「その他」で空欄なら空文字で保存される", () => {
    assert.equal(fromPortalSiteChoice({ select: PORTAL_SITE_OTHER, custom: "  " }), "")
})
