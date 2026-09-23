import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isAutomationAuthorized } from "./automation-auth"

describe("isAutomationAuthorized", () => {
    it("accepts the Bearer token that matches the secret", () => {
        assert.equal(isAutomationAuthorized("Bearer sync-secret", "sync-secret"), true)
    })

    it("rejects a missing header, a wrong token and a different length", () => {
        assert.equal(isAutomationAuthorized(null, "sync-secret"), false)
        assert.equal(isAutomationAuthorized("", "sync-secret"), false)
        assert.equal(isAutomationAuthorized("Bearer wrong-secret", "sync-secret"), false)
        assert.equal(isAutomationAuthorized("Bearer sync-secret-and-more", "sync-secret"), false)
        assert.equal(isAutomationAuthorized("Bearer ", "sync-secret"), false)
    })

    it("rejects a scheme other than Bearer", () => {
        assert.equal(isAutomationAuthorized("sync-secret", "sync-secret"), false)
        assert.equal(isAutomationAuthorized("Basic sync-secret", "sync-secret"), false)
    })

    it("rejects everything when the secret is not configured", () => {
        assert.equal(isAutomationAuthorized("Bearer ", undefined), false)
        assert.equal(isAutomationAuthorized("Bearer ", ""), false)
        assert.equal(isAutomationAuthorized("Bearer anything", ""), false)
    })
})
