import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    buildAuthorizationHeader,
    createSignature,
    createSignatureBaseString,
    normalizeParams,
    percentEncode,
} from "./zaim-oauth"

// RFC 5849 / Twitter が公開している OAuth 1.0a の検証用データ。
// Zaim固有の値ではなく署名アルゴリズムそのものの検証に使う（Zaimは同じHMAC-SHA1）。
const twitter = {
    method: "POST",
    url: "https://api.twitter.com/1/statuses/update.json",
    params: {
        include_entities: "true",
        status: "Hello Ladies + Gentlemen, a signed OAuth request!",
    },
    consumerKey: "xvz1evFS4wEEPTGEFPHBog",
    consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
    tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
    timestamp: 1318622958,
    expectedSignature: "tnnArxj06cWHq44gCs1OSKk/jLY=",
}

describe("percentEncode", () => {
    it("encodes the characters encodeURIComponent leaves alone", () => {
        assert.equal(percentEncode("!*'()"), "%21%2A%27%28%29")
    })

    it("leaves unreserved characters untouched", () => {
        assert.equal(percentEncode("aZ0-._~"), "aZ0-._~")
    })

    it("encodes spaces as %20, not +", () => {
        assert.equal(percentEncode("a b"), "a%20b")
    })
})

describe("normalizeParams", () => {
    it("sorts by key and drops empty values", () => {
        assert.equal(
            normalizeParams({ b: "2", a: "1", c: undefined, d: null }),
            "a=1&b=2"
        )
    })

    it("sorts by value when keys are equal after encoding", () => {
        assert.equal(normalizeParams({ a: "2" }), "a=2")
    })

    it("accepts numbers", () => {
        assert.equal(normalizeParams({ amount: 1200 }), "amount=1200")
    })
})

describe("createSignatureBaseString / createSignature", () => {
    it("reproduces the published OAuth 1.0a signature", () => {
        const baseString = createSignatureBaseString(twitter.method, twitter.url, {
            ...twitter.params,
            oauth_consumer_key: twitter.consumerKey,
            oauth_nonce: twitter.nonce,
            oauth_signature_method: "HMAC-SHA1",
            oauth_timestamp: twitter.timestamp,
            oauth_token: twitter.token,
            oauth_version: "1.0",
        })
        assert.equal(
            createSignature(baseString, twitter.consumerSecret, twitter.tokenSecret),
            twitter.expectedSignature
        )
    })

    it("starts the base string with the upper-cased method and the encoded URL", () => {
        const baseString = createSignatureBaseString("post", "https://api.zaim.net/v2/home/money", {
            mapping: 1,
        })
        assert.equal(
            baseString,
            "POST&https%3A%2F%2Fapi.zaim.net%2Fv2%2Fhome%2Fmoney&mapping%3D1"
        )
    })
})

describe("buildAuthorizationHeader", () => {
    it("puts the signature in the header and quotes every value", () => {
        const header = buildAuthorizationHeader({
            method: twitter.method,
            url: twitter.url,
            params: twitter.params,
            consumerKey: twitter.consumerKey,
            consumerSecret: twitter.consumerSecret,
            token: twitter.token,
            tokenSecret: twitter.tokenSecret,
            nonce: twitter.nonce,
            timestamp: twitter.timestamp,
        })

        assert.ok(header.startsWith("OAuth "))
        assert.ok(
            header.includes('oauth_signature="' + percentEncode(twitter.expectedSignature) + '"')
        )
        assert.ok(header.includes('oauth_token="' + twitter.token + '"'))
    })

    it("omits oauth_token during the request-token step and carries oauth_callback", () => {
        const header = buildAuthorizationHeader({
            method: "POST",
            url: "https://api.zaim.net/v2/auth/request",
            consumerKey: "key",
            consumerSecret: "secret",
            extraOAuthParams: { oauth_callback: "http://localhost:9153/zaim/callback" },
            nonce: "n",
            timestamp: 1,
        })

        assert.equal(header.includes("oauth_token="), false)
        assert.ok(header.includes("oauth_callback="))
    })
})
