import assert from "node:assert/strict"
import { test } from "node:test"
import { applyKeypadKey, formatAmountRaw, KEYPAD_MAX_DIGITS } from "./amount-keypad"

const press = (keys: string[], options = {}) => keys.reduce((raw, key) => applyKeypadKey(raw, key, options), "")

test("数字を押すたびに3桁区切りのカンマが入る", () => {
    assert.equal(formatAmountRaw(press(["1"])), "1")
    assert.equal(formatAmountRaw(press(["1", "2", "3"])), "123")
    assert.equal(formatAmountRaw(press(["1", "2", "3", "4"])), "1,234")
    assert.equal(formatAmountRaw(press(["1", "2", "3", "4", "5", "6", "7"])), "1,234,567")
})

test("負の金額・小数でもカンマが維持される", () => {
    const opts = { allowNegative: true, allowDecimal: true }
    assert.equal(formatAmountRaw(press(["1", "2", "3", "4", "sign"], opts)), "-1,234")
    assert.equal(formatAmountRaw(press(["1", "2", "3", "4", ".", "5"], opts)), "1,234.5")
    assert.equal(formatAmountRaw("-"), "-")
    assert.equal(formatAmountRaw(""), "")
})

test("±は許可されたときだけ効き、もう一度押すと正に戻る", () => {
    assert.equal(press(["5", "sign"]), "5")
    assert.equal(press(["5", "sign"], { allowNegative: true }), "-5")
    assert.equal(press(["5", "sign", "sign"], { allowNegative: true }), "5")
    assert.equal(press(["sign", "5"], { allowNegative: true }), "-5")
})

test("小数点は許可されたときだけ入り、2つ目は無視される", () => {
    assert.equal(press(["1", "."]), "1")
    assert.equal(press([".", "5"], { allowDecimal: true }), "0.5")
    assert.equal(press(["1", ".", "5", ".", "2"], { allowDecimal: true }), "1.52")
})

test("先頭の0は1つにまとめ、00は桁を2つ進める", () => {
    assert.equal(press(["0", "0"]), "0")
    assert.equal(press(["0", "5"]), "5")
    assert.equal(press(["00"]), "0")
    assert.equal(press(["1", "00"]), "100")
    assert.equal(press(["1", "00", "00"]), "10000")
})

test("⌫は1文字消し、符号だけが残ったら空にする", () => {
    assert.equal(press(["1", "2", "bs"]), "1")
    assert.equal(press(["5", "sign", "bs"], { allowNegative: true }), "")
    assert.equal(press(["bs"]), "")
})

test("桁数の上限を超える入力は無視される", () => {
    const full = "9".repeat(KEYPAD_MAX_DIGITS)
    assert.equal(applyKeypadKey(full, "1"), full)
    assert.equal(applyKeypadKey(full.slice(1), "00"), full.slice(1))
})
