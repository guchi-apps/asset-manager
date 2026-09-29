import { afterEach, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { getSharedTokenOrEnv, resolveSharedToken, SHARED_TOKEN_CONSUMER } from "./shared-token"

const originalFetch = globalThis.fetch
const originalError = console.error
const saved = {
    url: process.env.ISSUE_DECK_URL,
    secret: process.env.SHARED_TOKEN_API_SECRET,
}

function restore(key: "ISSUE_DECK_URL" | "SHARED_TOKEN_API_SECRET", value: string | undefined) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
}

beforeEach(() => {
    process.env.ISSUE_DECK_URL = "https://deck.example/"
    process.env.SHARED_TOKEN_API_SECRET = "api-bearer"
    console.error = () => {}
})

afterEach(() => {
    globalThis.fetch = originalFetch
    console.error = originalError
    restore("ISSUE_DECK_URL", saved.url)
    restore("SHARED_TOKEN_API_SECRET", saved.secret)
})

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = []
    globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
        calls.push({ url: String(input), init })
        return handler(String(input), init)
    }) as typeof fetch
    return calls
}

describe("resolveSharedToken", () => {
    it("Bearerと利用元ヘッダーを付けて取得し、値をキャッシュへ入れる", async () => {
        const calls = stubFetch(() => Response.json({ name: "OPS_API_TOKEN", value: " tok " }))
        const result = await resolveSharedToken("OPS_API_TOKEN", null, { now: 1000 })
        assert.equal(result.value, "tok")
        assert.deepEqual(result.cache, { value: "tok", fetchedAtMs: 1000 })
        assert.equal(calls[0].url, "https://deck.example/api/shared-tokens?name=OPS_API_TOKEN")
        const headers = calls[0].init.headers as Record<string, string>
        assert.equal(headers.Authorization, "Bearer api-bearer")
        assert.equal(headers["X-Shared-Token-Consumer"], SHARED_TOKEN_CONSUMER)
        assert.equal(SHARED_TOKEN_CONSUMER, "asset-manager")
    })

    it("10分以内のキャッシュがあれば取得しに行かない", async () => {
        const calls = stubFetch(() => Response.json({ value: "new" }))
        const result = await resolveSharedToken("X", { value: "old", fetchedAtMs: 0 }, { now: 9 * 60 * 1000 })
        assert.equal(result.value, "old")
        assert.equal(calls.length, 0)
    })

    it("取得に失敗したら古くても直前の値を使う", async () => {
        stubFetch(() => new Response("boom", { status: 500 }))
        const previous = { value: "old", fetchedAtMs: 0 }
        const result = await resolveSharedToken("X", previous, { now: 11 * 60 * 1000 })
        assert.equal(result.value, "old")
        assert.deepEqual(result.cache, { value: "old", fetchedAtMs: 11 * 60 * 1000, failed: true })
    })

    it("失敗の直後30秒は再試行せず、過ぎたら再試行する", async () => {
        const calls = stubFetch(() => new Response("boom", { status: 503 }))
        const first = await resolveSharedToken("X", null, { now: 1000 })
        assert.equal(first.value, null)
        assert.equal(calls.length, 1)

        const second = await resolveSharedToken("X", first.cache, { now: 1000 + 29_000 })
        assert.equal(second.value, null)
        assert.equal(calls.length, 1)

        stubFetch(() => Response.json({ value: "back" }))
        const third = await resolveSharedToken("X", second.cache, { now: 1000 + 31_000 })
        assert.equal(third.value, "back")
        assert.deepEqual(third.cache, { value: "back", fetchedAtMs: 32_000 })
    })

    it("直前の値も無ければ null を返す（呼び出し側が環境変数へ落ちる）", async () => {
        stubFetch(() => {
            throw new Error("network down")
        })
        assert.equal((await resolveSharedToken("X", null)).value, null)
    })

    it("応答の value が空・欠落なら失敗として扱う", async () => {
        stubFetch(() => Response.json({ value: "  " }))
        assert.equal((await resolveSharedToken("X", null)).value, null)
    })

    it("URL・Bearerが未設定なら取得せず null", async () => {
        delete process.env.ISSUE_DECK_URL
        const calls = stubFetch(() => Response.json({ value: "v" }))
        assert.equal((await resolveSharedToken("X", null)).value, null)
        assert.equal(calls.length, 0)
    })

    it("失敗ログにトークン値もBearerも出さない", async () => {
        const logged: unknown[][] = []
        console.error = (...args: unknown[]) => void logged.push(args)
        stubFetch(() => new Response("api-bearer leaked-token", { status: 502 }))
        await resolveSharedToken("X", null)
        const text = JSON.stringify(logged)
        assert.ok(!text.includes("api-bearer"))
        assert.ok(!text.includes("leaked-token"))
    })
})

describe("getSharedTokenOrEnv", () => {
    it("共有トークンが取れなければ環境変数の値を返す", async () => {
        delete process.env.SHARED_TOKEN_API_SECRET
        assert.equal(await getSharedTokenOrEnv("FALLBACK_CASE", "from-env"), "from-env")
        assert.equal(await getSharedTokenOrEnv("FALLBACK_CASE", ""), undefined)
    })

    it("共有トークンが取れればそちらを優先する", async () => {
        stubFetch(() => Response.json({ value: "from-shared" }))
        assert.equal(await getSharedTokenOrEnv("PRIORITY_CASE", "from-env"), "from-shared")
    })
})
