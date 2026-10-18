import { afterEach, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { clearSharedTokenCacheForTests } from "./shared-token"
import { DEFAULT_AIDE_BASE_URL } from "./zaim-aide"
import { getZaimWebGenreConfig } from "./zaim-web-genre"
import { getZaimWebMemoConfig } from "./zaim-web-memo"
import { getZaimWebPaymentConfig } from "./zaim-web-payment"
import { getZaimWebWriteConfig } from "./zaim-web-write-config"

const KEYS = ["ISSUE_DECK_URL", "SHARED_TOKEN_API_SECRET", "AIDE_ZAIM_WRITE_SECRET", "AIDE_BASE_URL"] as const
const originalFetch = globalThis.fetch
const originalError = console.error
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))
    for (const key of KEYS) delete process.env[key]
    clearSharedTokenCacheForTests()
    console.error = () => {}
})

afterEach(() => {
    globalThis.fetch = originalFetch
    console.error = originalError
    for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
    clearSharedTokenCacheForTests()
})

function stubFetch(handler: (url: string) => Response) {
    const calls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
        calls.push(String(input))
        return handler(String(input))
    }) as typeof fetch
    return calls
}

function useSharedTokenApi() {
    process.env.ISSUE_DECK_URL = "https://deck.example"
    process.env.SHARED_TOKEN_API_SECRET = "api-bearer"
}

describe("getZaimWebWriteConfig（#758）", () => {
    it("共有トークン AIDE_ZAIM_WRITE_SECRET が取れればそれを使い、環境変数より優先する", async () => {
        useSharedTokenApi()
        process.env.AIDE_ZAIM_WRITE_SECRET = "env-secret"
        const calls = stubFetch(() => new Response(JSON.stringify({ value: "shared-secret" }), { status: 200 }))

        assert.deepEqual(await getZaimWebWriteConfig(), {
            baseUrl: DEFAULT_AIDE_BASE_URL,
            secret: "shared-secret",
        })
        assert.equal(calls.length, 1)
        assert.equal(calls[0], "https://deck.example/api/shared-tokens?name=AIDE_ZAIM_WRITE_SECRET")
    })

    it("共有トークンの取得に失敗したら環境変数へフォールバックする", async () => {
        useSharedTokenApi()
        process.env.AIDE_ZAIM_WRITE_SECRET = "env-secret"
        stubFetch(() => new Response("error", { status: 500 }))

        assert.equal((await getZaimWebWriteConfig())?.secret, "env-secret")
    })

    it("共有トークンAPIが未設定なら取りにいかず環境変数を使う", async () => {
        process.env.AIDE_ZAIM_WRITE_SECRET = "env-secret"
        const calls = stubFetch(() => new Response("unexpected", { status: 500 }))

        assert.equal((await getZaimWebWriteConfig())?.secret, "env-secret")
        assert.equal(calls.length, 0)
    })

    it("共有トークンも環境変数も無ければ null（Web版登録・内訳・メモのどれも未設定扱い）", async () => {
        useSharedTokenApi()
        stubFetch(() => new Response("error", { status: 500 }))

        assert.equal(await getZaimWebWriteConfig(), null)
        assert.equal(await getZaimWebPaymentConfig(), null)
        assert.equal(await getZaimWebGenreConfig(), null)
        assert.equal(await getZaimWebMemoConfig(), null)
    })

    it("Web版登録・内訳・メモの3つが同じ共有トークンを使う", async () => {
        useSharedTokenApi()
        process.env.AIDE_BASE_URL = "http://127.0.0.1:9999/"
        stubFetch(() => new Response(JSON.stringify({ value: "shared-secret" }), { status: 200 }))

        const expected = { baseUrl: "http://127.0.0.1:9999", secret: "shared-secret" }
        assert.deepEqual(await getZaimWebPaymentConfig(), expected)
        assert.deepEqual(await getZaimWebGenreConfig(), expected)
        assert.deepEqual(await getZaimWebMemoConfig(), expected)
    })
})
