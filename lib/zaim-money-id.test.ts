import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { toMoneyIdNumber, toMoneyIdNumberOrNull } from "./zaim-money-id"

/** 2026-08時点で実際にZaim APIが返した最大のmoney id。INTの上限を大きく超える。 */
const REAL_MONEY_ID = 10_212_021_703
const MYSQL_INT_MAX = 2_147_483_647

/**
 * money idを保存する列。Intへ戻すと取り込みが
 * 「Out of range value for column」で必ず失敗する（Issue #281）。
 */
const BIGINT_FIELDS = [
    ["ReceiptImport", "zaimMoneyId"],
    ["ReceiptItem", "zaimMoneyId"],
    ["ReceiptItem", "sourceZaimMoneyId"],
    ["ZaimGenreSuggestion", "zaimMoneyId"],
    ["ZaimCopiedEntry", "sourceMoneyId"],
    ["ZaimCopiedEntry", "copiedMoneyId"],
] as const

function readModelBlock(schema: string, model: string): string {
    const start = schema.indexOf("\nmodel " + model + " {")
    assert.notEqual(start, -1, model + " がschema.prismaに見つからない")
    const end = schema.indexOf("\n}", start)
    return schema.slice(start, end)
}

describe("Zaimのmoney idを保存する列", () => {
    const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf-8")

    for (const [model, field] of BIGINT_FIELDS) {
        it(model + "." + field + " はBigIntで持つ", () => {
            const block = readModelBlock(schema, model)
            const line = block.split("\n").find((row) => row.trim().startsWith(field + " "))
            assert.ok(line, model + "." + field + " の定義が見つからない")
            assert.match(line, /\bBigInt\b/)
        })
    }
})

describe("toMoneyIdNumber", () => {
    it("INTに収まらない実際のmoney idを number へ戻せる", () => {
        assert.ok(REAL_MONEY_ID > MYSQL_INT_MAX)
        assert.equal(toMoneyIdNumber(BigInt(REAL_MONEY_ID)), REAL_MONEY_ID)
        assert.ok(Number.isSafeInteger(toMoneyIdNumber(BigInt(REAL_MONEY_ID))))
    })

    it("null はそのまま null で返す", () => {
        assert.equal(toMoneyIdNumberOrNull(null), null)
        assert.equal(toMoneyIdNumberOrNull(BigInt(REAL_MONEY_ID)), REAL_MONEY_ID)
    })
})
