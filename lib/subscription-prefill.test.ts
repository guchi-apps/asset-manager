import assert from "node:assert/strict"
import { test } from "node:test"

import { parseSubscriptionPrefill } from "./subscription-prefill"

test("new=1 でなければ null", () => {
    assert.equal(parseSubscriptionPrefill({}), null)
    assert.equal(parseSubscriptionPrefill({ new: "0", name: "A" }), null)
})

test("正しい値はそのまま読む", () => {
    assert.deepEqual(
        parseSubscriptionPrefill({
            new: "1",
            name: " Netflix ",
            amount: "1590",
            currency: "USD",
            cycle: "YEARLY",
            day: "15",
            start: "2026-11-01",
        }),
        { name: "Netflix", amount: "1590", currency: "USD", cycle: "YEARLY", day: 15, start: "2026-11-01" }
    )
})

test("不正な値はその項目だけ無視する", () => {
    assert.deepEqual(
        parseSubscriptionPrefill({
            new: "1",
            name: "X",
            amount: "-5",
            currency: "EUR",
            cycle: "WEEKLY",
            day: "32",
            start: "2026-02-30",
        }),
        { name: "X" }
    )
    assert.deepEqual(parseSubscriptionPrefill({ new: "1", amount: "abc", day: "0" }), {})
})

test("配列で渡されたら先頭を使い、名前は長さを切る", () => {
    const result = parseSubscriptionPrefill({ new: ["1", "1"], name: ["a".repeat(150)] })
    assert.equal(result?.name?.length, 100)
})
