import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { decideZaimAutoSave, describeZaimSkipReason } from "./zaim-sync-policy"

const base = {
    hasValueToday: false,
    baselineValue: 100000,
    amount: 110000,
    overwriteExisting: false,
    detectLargeDiff: true,
}

describe("decideZaimAutoSave", () => {
    it("saves when there is no value for the day and the change is small", () => {
        assert.deepEqual(decideZaimAutoSave(base), { action: "save" })
    })

    it("skips when a value already exists and overwriting is disabled", () => {
        assert.deepEqual(decideZaimAutoSave({ ...base, hasValueToday: true }), {
            action: "skip",
            reason: "existing",
        })
    })

    it("overwrites an existing value when overwriting is enabled", () => {
        assert.deepEqual(
            decideZaimAutoSave({ ...base, hasValueToday: true, overwriteExisting: true }),
            { action: "save" }
        )
    })

    it("skips a change larger than the threshold", () => {
        assert.deepEqual(decideZaimAutoSave({ ...base, amount: 160000 }), {
            action: "skip",
            reason: "largeDiff",
        })
        assert.deepEqual(decideZaimAutoSave({ ...base, amount: 40000 }), {
            action: "skip",
            reason: "largeDiff",
        })
    })

    it("saves a large change when detection is disabled", () => {
        assert.deepEqual(
            decideZaimAutoSave({ ...base, amount: 160000, detectLargeDiff: false }),
            { action: "save" }
        )
    })

    it("saves when there is no baseline to compare against", () => {
        assert.deepEqual(decideZaimAutoSave({ ...base, baselineValue: null, amount: 999999 }), {
            action: "save",
        })
    })

    it("checks the existing value first so an overwrite-blocked entry is not reported as a large diff", () => {
        assert.deepEqual(decideZaimAutoSave({ ...base, hasValueToday: true, amount: 999999 }), {
            action: "skip",
            reason: "existing",
        })
    })
})

describe("describeZaimSkipReason", () => {
    it("returns a message for every reason", () => {
        for (const reason of ["existing", "largeDiff", "writeFailed"] as const) {
            assert.ok(describeZaimSkipReason(reason).length > 0)
        }
    })
})
