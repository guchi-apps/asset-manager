import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    buildCopyComment,
    buildCopyPayloads,
    excludeSkippedPayloads,
    parseCopyComment,
    selectCopyTargets,
    validateCopyRule,
    type CopyableMoneyEntry,
    type CopyRule,
} from "./zaim-copy"

const SOURCE_ACCOUNT = 21351678
const TARGET_ACCOUNT = 14255306

const rule: CopyRule = {
    id: 1,
    fromAccountId: SOURCE_ACCOUNT,
    toAccountId: TARGET_ACCOUNT,
    lookbackDays: 60,
    enabled: true,
    autoCopy: false,
}

function entry(overrides: Partial<CopyableMoneyEntry> & { id: number }): CopyableMoneyEntry {
    return {
        date: "2026-08-28",
        amount: 1200,
        name: "商品",
        place: "イオン西新井店",
        fromAccountId: SOURCE_ACCOUNT,
        categoryId: 101,
        genreId: 10101,
        comment: null,
        active: true,
        ...overrides,
    }
}

describe("parseCopyComment", () => {
    it("reads the source money id back out of the comment", () => {
        assert.equal(parseCopyComment(buildCopyComment(12345)), 12345)
    })

    it("finds the marker even when other text comes first", () => {
        assert.equal(parseCopyComment("メモ " + buildCopyComment(77) + " 追記"), 77)
    })

    it("returns null for comments without the marker", () => {
        assert.equal(parseCopyComment(null), null)
        assert.equal(parseCopyComment(""), null)
        assert.equal(parseCopyComment("ふつうのメモ"), null)
    })
})

describe("selectCopyTargets", () => {
    const copiedSourceIds = new Set<number>()

    it("keeps only entries from the source account", () => {
        const targets = selectCopyTargets(
            [entry({ id: 1 }), entry({ id: 2, fromAccountId: 999 })],
            rule,
            { copiedSourceIds }
        )
        assert.deepEqual(
            targets.map((target) => target.id),
            [1]
        )
    })

    it("skips entries excluded from totals in Zaim", () => {
        const targets = selectCopyTargets([entry({ id: 3, active: false })], rule, {
            copiedSourceIds,
        })
        assert.equal(targets.length, 0)
    })

    it("skips entries that were already copied", () => {
        const targets = selectCopyTargets([entry({ id: 4 })], rule, {
            copiedSourceIds: new Set([4]),
        })
        assert.equal(targets.length, 0)
    })

    it("never copies an entry that is itself a copy", () => {
        // 複製先が別のルールのコピー元になっていると、印が無ければ無限に増える。
        const targets = selectCopyTargets([entry({ id: 5, comment: buildCopyComment(4) })], rule, {
            copiedSourceIds,
        })
        assert.equal(targets.length, 0)
    })

    it("skips non-positive amounts", () => {
        const targets = selectCopyTargets([entry({ id: 6, amount: 0 })], rule, { copiedSourceIds })
        assert.equal(targets.length, 0)
    })
})

describe("buildCopyPayloads", () => {
    it("registers the copy against the destination account with the marker comment", () => {
        const { payloads } = buildCopyPayloads([entry({ id: 7 })], rule)

        assert.equal(payloads.length, 1)
        assert.equal(payloads[0].fromAccountId, TARGET_ACCOUNT)
        assert.equal(payloads[0].sourceMoneyId, 7)
        assert.equal(payloads[0].amount, 1200)
        assert.equal(payloads[0].comment, buildCopyComment(7))
    })

    it("skips entries whose genre is undecided", () => {
        // Zaimの支出登録はカテゴリ・内訳を必須にするため、決まっていない行は複製できない。
        const { payloads, skipped } = buildCopyPayloads([entry({ id: 8, genreId: null })], rule)

        assert.equal(payloads.length, 0)
        assert.deepEqual(
            skipped.map((item) => item.id),
            [8]
        )
    })

    it("keeps an empty name as null instead of an empty string", () => {
        const { payloads } = buildCopyPayloads([entry({ id: 9, name: "   " })], rule)
        assert.equal(payloads[0].name, null)
    })
})

describe("validateCopyRule", () => {
    it("rejects copying an account onto itself", () => {
        const message = validateCopyRule({
            fromAccountId: SOURCE_ACCOUNT,
            toAccountId: SOURCE_ACCOUNT,
            lookbackDays: 60,
        })
        assert.equal(message, "コピー元とコピー先には別の口座を選んでください")
    })

    it("rejects an out-of-range lookback", () => {
        assert.notEqual(
            validateCopyRule({
                fromAccountId: SOURCE_ACCOUNT,
                toAccountId: TARGET_ACCOUNT,
                lookbackDays: 0,
            }),
            null
        )
        assert.notEqual(
            validateCopyRule({
                fromAccountId: SOURCE_ACCOUNT,
                toAccountId: TARGET_ACCOUNT,
                lookbackDays: 400,
            }),
            null
        )
    })

    it("accepts a well-formed rule", () => {
        assert.equal(
            validateCopyRule({
                fromAccountId: SOURCE_ACCOUNT,
                toAccountId: TARGET_ACCOUNT,
                lookbackDays: 60,
            }),
            null
        )
    })
})

describe("excludeSkippedPayloads", () => {
    const payloads = buildCopyPayloads(
        [entry({ id: 11 }), entry({ id: 22 }), entry({ id: 33 })],
        rule
    ).payloads

    it("keeps every payload when nothing was unchecked", () => {
        const { chosen, skippedByUser } = excludeSkippedPayloads(payloads, new Set())
        assert.equal(chosen.length, 3)
        assert.equal(skippedByUser.length, 0)
        // 選別が無いときは同じ配列をそのまま返す（余計なコピーを作らない）。
        assert.equal(chosen, payloads)
    })

    it("drops the payloads the user unchecked in the preview", () => {
        const { chosen, skippedByUser } = excludeSkippedPayloads(payloads, new Set([22]))
        assert.deepEqual(
            chosen.map((payload) => payload.sourceMoneyId),
            [11, 33]
        )
        assert.deepEqual(
            skippedByUser.map((payload) => payload.sourceMoneyId),
            [22]
        )
    })

    it("ignores ids that are not among the candidates", () => {
        const { chosen, skippedByUser } = excludeSkippedPayloads(payloads, new Set([999]))
        assert.equal(chosen.length, 3)
        assert.equal(skippedByUser.length, 0)
    })

    it("can exclude everything", () => {
        const { chosen, skippedByUser } = excludeSkippedPayloads(payloads, new Set([11, 22, 33]))
        assert.equal(chosen.length, 0)
        assert.equal(skippedByUser.length, 3)
    })
})
