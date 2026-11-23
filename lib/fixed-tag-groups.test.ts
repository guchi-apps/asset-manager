import { test } from "node:test"
import assert from "node:assert/strict"
import { FIXED_TAG_GROUPS, arrangeFixedTagGroups, isFixedTagGroupKey, missingFixedTagGroups } from "./fixed-tag-groups"

test("固定の分類は 資産クラス・投資口座・NISA・企業型DC の4つ", () => {
    assert.deepEqual(FIXED_TAG_GROUPS.map((g) => g.name), ["資産クラス", "投資口座", "NISA", "企業型DC"])
})

test("missingFixedTagGroups: 作られていない分類だけを表示順で返す", () => {
    assert.deepEqual(missingFixedTagGroups([]).map((g) => [g.key, g.order]), [["ASSET_CLASS", 0], ["ACCOUNT", 1], ["NISA", 2], ["DC", 3]])
    assert.deepEqual(missingFixedTagGroups(["NISA", null, "ASSET_CLASS"]).map((g) => g.key), ["ACCOUNT", "DC"])
    assert.deepEqual(missingFixedTagGroups(["ASSET_CLASS", "ACCOUNT", "NISA", "DC"]), [])
})

test("arrangeFixedTagGroups: 固定の順に並べ、key の無い行・未知の key は落とし、名前はコードの定義にする", () => {
    const rows = [
        { id: 9, key: "DC", name: "古い名前" },
        { id: 3, key: null, name: "通貨" },
        { id: 1, key: "ASSET_CLASS", name: "資産クラス" },
        { id: 5, key: "UNKNOWN", name: "?" },
        { id: 2, key: "ASSET_CLASS", name: "重複" },
    ]
    const out = arrangeFixedTagGroups(rows)
    assert.deepEqual(out.map((g) => [g.id, g.key, g.name, g.order]), [
        [1, "ASSET_CLASS", "資産クラス", 0],
        [9, "DC", "企業型DC", 3],
    ])
})

test("isFixedTagGroupKey", () => {
    assert.equal(isFixedTagGroupKey("NISA"), true)
    assert.equal(isFixedTagGroupKey("NISA_FRAME"), false)
    assert.equal(isFixedTagGroupKey(null), false)
})
