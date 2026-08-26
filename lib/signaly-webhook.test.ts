import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { SIGNALY_SOURCE, buildSignalyPayload } from "./signaly-webhook"

describe("buildSignalyPayload", () => {
    it("adds source when given", () => {
        assert.deepEqual(buildSignalyPayload("hello", { source: SIGNALY_SOURCE }), {
            source: "Asset Manager",
            content: "hello",
        })
    })

    it("omits source when not given", () => {
        assert.deepEqual(buildSignalyPayload("hello"), { content: "hello" })
        assert.deepEqual(buildSignalyPayload("hello", {}), { content: "hello" })
    })
})

describe("SIGNALY_SOURCE", () => {
    // CI・デプロイ通知は NOTIFY_APP から embed の `App` フィールドを作り、Signalyは
    // それを送信元にする。ここがずれると通知一覧の送信元が2つに割れる。
    it("matches the app name used by CI notifications", () => {
        assert.equal(SIGNALY_SOURCE, "Asset Manager")
    })
})
