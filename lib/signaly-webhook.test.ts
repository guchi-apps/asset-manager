import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { SIGNALY_SOURCE, buildSignalyPayload } from "./signaly-webhook"

describe("buildSignalyPayload", () => {
    it("adds source when given", () => {
        assert.deepEqual(buildSignalyPayload("hello", { source: SIGNALY_SOURCE }), {
            source: "asset-manager",
            content: "hello",
        })
    })

    it("omits source when not given", () => {
        assert.deepEqual(buildSignalyPayload("hello"), { content: "hello" })
        assert.deepEqual(buildSignalyPayload("hello", {}), { content: "hello" })
    })
})

describe("SIGNALY_SOURCE", () => {
    it("matches the repository name used by CI notifications", () => {
        assert.equal(SIGNALY_SOURCE, "asset-manager")
    })
})
