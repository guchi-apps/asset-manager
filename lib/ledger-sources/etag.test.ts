import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { isEtagUsable, LEDGER_ETAG_MAX_AGE_MS } from "./etag"
import { moneyTransactionsPath } from "../zaim-aide-money"

const now = new Date("2026-11-08T00:00:00Z")

describe("isEtagUsable", () => {
    it("無い・保存時刻が無いときは使わない", () => {
        assert.equal(isEtagUsable(null, now, now), false)
        assert.equal(isEtagUsable('W/"a"', null, now), false)
    })
    it("24時間未満なら使い、ちょうど24時間以上たったら使わない", () => {
        assert.equal(isEtagUsable('W/"a"', new Date(now.getTime() - LEDGER_ETAG_MAX_AGE_MS + 1), now), true)
        assert.equal(isEtagUsable('W/"a"', new Date(now.getTime() - LEDGER_ETAG_MAX_AGE_MS), now), false)
    })
    it("保存時刻が未来（時計のずれ）なら使わない", () => {
        assert.equal(isEtagUsable('W/"a"', new Date(now.getTime() + 1000), now), false)
    })
})

describe("moneyTransactionsPath", () => {
    it("from が正しい日付ならクエリを付け、無い・不正なら付けない", () => {
        assert.equal(moneyTransactionsPath("2026-09-09"), "/api/money/transactions?from=2026-09-09")
        assert.equal(moneyTransactionsPath(), "/api/money/transactions")
        assert.equal(moneyTransactionsPath("x&to=1"), "/api/money/transactions")
    })
})

// 取り込みの結果が変わりうる書き込み口が、ETagの破棄を呼んでいること（呼び忘れると304で見送られ続ける）
describe("ETagを破棄する書き込み口", () => {
    const sites: Array<[string, string, number]> = [
        ["lib/ledger-sources/review-service.ts", "invalidateLedgerSourceEtag(userId)", 1],
        ["lib/ledger-sources/mapping-service.ts", "invalidateLedgerSourceEtag(userId)", 4],
        ["lib/ledger-category-import-service.ts", "invalidateLedgerSourceEtag(userId, tx)", 1],
        ["lib/ledger-sources/csv-service.ts", "invalidateLedgerSourceEtag(userId)", 2],
        ["lib/ledger-service.ts", "invalidateLedgerSourceEtag(userId, tx)", 2],
        ["lib/ledger-service.ts", "data: LEDGER_ETAG_CLEARED", 3],
    ]
    for (const [file, needle, count] of sites) {
        it(`${file} が ${needle} を ${count} 回呼ぶ`, () => {
            const source = readFileSync(file, "utf8")
            assert.equal(source.split(needle).length - 1, count)
        })
    }
})
