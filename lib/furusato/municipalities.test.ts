import assert from "node:assert/strict"
import test from "node:test"

import { REGIONS, filterMunicipalities, findPrefecture, formatMunicipality, parseMunicipality } from "./municipalities"

test("8地域・47都道府県を持ち、市町村数は約1,700件", () => {
    assert.equal(REGIONS.length, 8)
    const prefectures = REGIONS.flatMap((r) => r.prefectures)
    assert.equal(prefectures.length, 47)
    const total = prefectures.reduce((sum, p) => sum + p.municipalities.length, 0)
    assert.ok(total > 1700 && total < 1800)
})

test("政令指定都市の区は市にまとめ、東京都の特別区は残す", () => {
    assert.ok(findPrefecture("北海道")?.municipalities.includes("札幌市"))
    assert.ok(!findPrefecture("北海道")?.municipalities.includes("札幌市中央区"))
    assert.ok(findPrefecture("東京都")?.municipalities.includes("千代田区"))
})

test("formatMunicipality: 市町村は「都道府県 市町村」、都道府県のみは都道府県名", () => {
    assert.equal(formatMunicipality("北海道", "紋別市"), "北海道 紋別市")
    assert.equal(formatMunicipality("北海道"), "北海道")
})

test("parseMunicipality: 保存済みの値から選択位置を復元し、一覧にない表記は undefined", () => {
    assert.deepEqual(parseMunicipality("北海道 紋別市"), { region: "北海道", prefecture: "北海道", municipality: "紋別市" })
    assert.deepEqual(parseMunicipality("宮崎県"), { region: "九州・沖縄", prefecture: "宮崎県", municipality: undefined })
    assert.equal(parseMunicipality("紋別市"), undefined)
    assert.equal(parseMunicipality("北海道 存在しない市"), undefined)
})

test("filterMunicipalities: 部分一致で絞り込み、空文字は全件", () => {
    const list = ["札幌市", "函館市", "紋別市"]
    assert.deepEqual(filterMunicipalities(list, "別"), ["紋別市"])
    assert.deepEqual(filterMunicipalities(list, " "), list)
})
