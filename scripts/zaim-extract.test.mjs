import assert from "node:assert/strict"
import test from "node:test"
import { mergeBalances, normalizeItems, normalizeZaimName, parseYen } from "./zaim-extract.mjs"

test("parses Zaim yen values", () => {
    assert.equal(parseYen("￥ -12,345"), -12345)
    assert.equal(parseYen("¥1,234"), 1234)
    assert.equal(parseYen("12 pt"), null)
})

test("normalizes whitespace used in valuation aliases", () => {
    assert.equal(normalizeZaimName("楽天カー ド\n"), "楽天カード")
})

test("security holdings take priority over home summaries with the same name", () => {
    const home = normalizeItems([{ name: "SBI 証券", amount: "￥2,800,000" }], "home", "https://zaim.net/home")
    const holdings = normalizeItems([{ name: "SBI 証券", amount: "￥2,804,744" }], "securityHolding", "https://zaim.net/securities/1")
    assert.deepEqual(mergeBalances(home, holdings), [{
        name: "SBI 証券", amount: 2804744, source: "securityHolding", url: "https://zaim.net/securities/1",
    }])
})

test("same holding across security accounts is aggregated", () => {
    const holdings = [
        ...normalizeItems([{ name: "投資信託A", amount: "￥100" }], "securityHolding", "https://zaim.net/securities/1"),
        ...normalizeItems([{ name: "投資信託 A", amount: "￥250" }], "securityHolding", "https://zaim.net/securities/2"),
    ]
    assert.equal(mergeBalances([], holdings)[0].amount, 350)
})
