import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildDiscordAlertPayload, isRetryableStatus, postDiscordAlert } from "./discord-alert"

const originalFetch = globalThis.fetch

afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.DISCORD_ALERT_WEBHOOK_URL
})

describe("buildDiscordAlertPayload", () => {
    it("embedにタイトルと本文を載せ、メンションを許さない", () => {
        const payload = buildDiscordAlertPayload("失敗", ["a", "b"])
        assert.equal(payload.embeds[0].title, "失敗")
        assert.equal(payload.embeds[0].description, "a\nb")
        assert.deepEqual(payload.allowed_mentions, { parse: [] })
    })

    it("長すぎる本文は切り詰める", () => {
        const payload = buildDiscordAlertPayload("t", ["x".repeat(5000)])
        assert.equal(payload.embeds[0].description.length, 1800)
    })
})

describe("isRetryableStatus", () => {
    it("429と5xxだけ再試行する", () => {
        assert.equal(isRetryableStatus(429), true)
        assert.equal(isRetryableStatus(503), true)
        assert.equal(isRetryableStatus(400), false)
        assert.equal(isRetryableStatus(404), false)
    })
})

describe("postDiscordAlert", () => {
    it("URL未設定なら送らずfalseを返す", async () => {
        let called = false
        globalThis.fetch = (async () => {
            called = true
            return new Response(null, { status: 204 })
        }) as typeof fetch
        assert.equal(await postDiscordAlert("t", ["x"]), false)
        assert.equal(called, false)
    })

    it("成功したら1回で終える", async () => {
        process.env.DISCORD_ALERT_WEBHOOK_URL = "https://example.invalid/hook"
        let calls = 0
        globalThis.fetch = (async () => {
            calls++
            return new Response(null, { status: 204 })
        }) as typeof fetch
        assert.equal(await postDiscordAlert("t", ["x"]), true)
        assert.equal(calls, 1)
    })

    it("4xxは再試行せず、例外も投げない", async () => {
        process.env.DISCORD_ALERT_WEBHOOK_URL = "https://example.invalid/hook"
        let calls = 0
        globalThis.fetch = (async () => {
            calls++
            return new Response(null, { status: 404 })
        }) as typeof fetch
        assert.equal(await postDiscordAlert("t", ["x"]), false)
        assert.equal(calls, 1)
    })

    it("429のあとに成功すれば再試行で届く", async () => {
        process.env.DISCORD_ALERT_WEBHOOK_URL = "https://example.invalid/hook"
        let calls = 0
        globalThis.fetch = (async () => {
            calls++
            return calls === 1
                ? new Response(null, { status: 429, headers: { "retry-after": "0.01" } })
                : new Response(null, { status: 204 })
        }) as typeof fetch
        assert.equal(await postDiscordAlert("t", ["x"]), true)
        assert.equal(calls, 2)
    })
})
