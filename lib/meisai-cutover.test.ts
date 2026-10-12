import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { hiddenMainMenus, isMeisaiCutoverComplete, isMeisaiGatedPath, meisaiClosedMessage } from "./meisai-cutover"

describe("meisai-cutover", () => {
    it("MEISAI_LAB_CUTOVER=1 のときだけ公開する", () => {
        assert.equal(isMeisaiCutoverComplete({}), false)
        assert.equal(isMeisaiCutoverComplete({ MEISAI_LAB_CUTOVER: "" }), false)
        assert.equal(isMeisaiCutoverComplete({ MEISAI_LAB_CUTOVER: "true" }), false)
        assert.equal(isMeisaiCutoverComplete({ MEISAI_LAB_CUTOVER: "1" }), true)
    })

    it("移した画面とAPIのパスだけを閉じる対象にする", () => {
        for (const p of ["/salaries", "/salaries/new", "/salaries/abc/edit", "/salaries/settings", "/bonuses", "/furusato/new", "/tax", "/api/salaries/import-pdf"]) {
            assert.equal(isMeisaiGatedPath(p), true, p)
        }
        for (const p of ["/", "/assets", "/taxonomy", "/salariesx", "/api/ai-usage", "/settings"]) {
            assert.equal(isMeisaiGatedPath(p), false, p)
        }
    })

    it("閉じている間は給与メニューを隠し、アクションは拒否する", () => {
        assert.deepEqual(hiddenMainMenus({}), ["payroll"])
        assert.deepEqual(hiddenMainMenus({ MEISAI_LAB_CUTOVER: "1" }), [])
        assert.ok(meisaiClosedMessage({}))
        assert.equal(meisaiClosedMessage({ MEISAI_LAB_CUTOVER: "1" }), null)
    })
})
