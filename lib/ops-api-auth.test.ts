import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isOpsApiAuthorized } from "./ops-api-auth"

describe("isOpsApiAuthorized", () => {
    it("accepts the Bearer token that matches OPS_API_TOKEN", () => {
        assert.equal(isOpsApiAuthorized("Bearer secret-token", "secret-token"), true)
    })

    it("rejects a request without an Authorization header", () => {
        assert.equal(isOpsApiAuthorized(null, "secret-token"), false)
        assert.equal(isOpsApiAuthorized("", "secret-token"), false)
    })

    it("rejects a wrong token, including one of a different length", () => {
        assert.equal(isOpsApiAuthorized("Bearer wrong-token!", "secret-token"), false)
        assert.equal(isOpsApiAuthorized("Bearer secret-token-and-more", "secret-token"), false)
        assert.equal(isOpsApiAuthorized("Bearer ", "secret-token"), false)
    })

    it("rejects a scheme other than Bearer", () => {
        assert.equal(isOpsApiAuthorized("secret-token", "secret-token"), false)
        assert.equal(isOpsApiAuthorized("Basic secret-token", "secret-token"), false)
    })

    it("rejects everything when OPS_API_TOKEN is not configured", () => {
        assert.equal(isOpsApiAuthorized("Bearer ", undefined), false)
        assert.equal(isOpsApiAuthorized("Bearer ", ""), false)
        assert.equal(isOpsApiAuthorized("Bearer anything", undefined), false)
    })
})
