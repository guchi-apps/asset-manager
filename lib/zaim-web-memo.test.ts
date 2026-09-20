import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { DEFAULT_AIDE_BASE_URL } from "./zaim-aide"
import { ZAIM_MEMO_MAX_LENGTH } from "./zaim-memo-draft"
import {
    buildZaimWebMemoBody,
    getZaimWebMemoConfig,
    normalizeZaimMemo,
    parseZaimWebMemoResponse,
    updateZaimWebMemo,
    ZaimWebMemoError,
    ZAIM_WEB_MEMO_PATH,
    type ZaimWebMemoInput,
} from "./zaim-web-memo"

/** 環境変数を触るテストは、終わったら必ず元へ戻す（他のテストへ漏らさない）。 */
function withEnv(values: Record<string, string | undefined>, run: () => void) {
    const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
    try {
        for (const [key, value] of Object.entries(values)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
        run()
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    }
}

const input: ZaimWebMemoInput = {
    requestId: "asset-manager:zaim-memo:12:deadbeef",
    moneyId: 12,
    date: "2026-09-17",
    amount: 1284,
    comment: "おにぎり 158円／牛乳 218円",
}

describe("getZaimWebMemoConfig", () => {
    it("AIDE_ZAIM_WRITE_SECRET が無ければ null を返す", () => {
        withEnv({ AIDE_ZAIM_WRITE_SECRET: undefined, AIDE_BASE_URL: undefined }, () => {
            assert.equal(getZaimWebMemoConfig(), null)
        })
    })

    it("Web版登録（#302）・内訳の書き戻し（#421）と同じシークレットを使う", () => {
        withEnv({ AIDE_ZAIM_WRITE_SECRET: "write-secret", AIDE_BASE_URL: undefined }, () => {
            assert.deepEqual(getZaimWebMemoConfig(), {
                baseUrl: DEFAULT_AIDE_BASE_URL,
                secret: "write-secret",
            })
        })
    })
})

describe("normalizeZaimMemo", () => {
    it("改行と連続した空白を1つの空白へ寄せ、前後を落とす", () => {
        assert.equal(normalizeZaimMemo("  パン 150円\n牛乳  218円 "), "パン 150円 牛乳 218円")
    })

    it("Zaimの上限で切る（超えたまま送ってもAIDEに弾かれるだけ）", () => {
        assert.equal(normalizeZaimMemo("あ".repeat(200)).length, ZAIM_MEMO_MAX_LENGTH)
    })
})

describe("buildZaimWebMemoBody", () => {
    it("受け口の必須項目をすべて載せる（メモ以外は取り違えの検知に使われる）", () => {
        assert.deepEqual(buildZaimWebMemoBody(input), {
            requestId: input.requestId,
            moneyId: 12,
            date: "2026-09-17",
            amount: 1284,
            comment: input.comment,
        })
    })
})

describe("parseZaimWebMemoResponse", () => {
    it("moneyId と duplicated を取り出す", () => {
        assert.deepEqual(parseZaimWebMemoResponse({ ok: true, moneyId: 12, duplicated: true }), {
            moneyId: 12,
            duplicated: true,
        })
    })

    it("ok が立っていない応答は成功として扱わない", () => {
        assert.throws(() => parseZaimWebMemoResponse({ moneyId: 12 }), ZaimWebMemoError)
        assert.throws(() => parseZaimWebMemoResponse({ ok: true }), ZaimWebMemoError)
    })
})

describe("updateZaimWebMemo", () => {
    it("設定が無ければ notConfigured で止まる（AIDEへは行かない）", async () => {
        await withEnvAsync({ AIDE_ZAIM_WRITE_SECRET: undefined }, async () => {
            await assert.rejects(updateZaimWebMemo(input), (error: unknown) => {
                assert.ok(error instanceof ZaimWebMemoError)
                assert.equal(error.reason, "notConfigured")
                return true
            })
        })
    })

    it("404 は notImplemented（受け口がまだ無い）。送り直しても直らないので retryable ではない", async () => {
        await withFetch(
            new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
            async (calls) => {
                await assert.rejects(updateZaimWebMemo(input), (error: unknown) => {
                    assert.ok(error instanceof ZaimWebMemoError)
                    assert.equal(error.reason, "notImplemented")
                    assert.equal(error.retryable, false)
                    // 受け口が無いときは、AIDEの本文（"not found"）ではなく次の手を出す。
                    assert.match(error.message, /コピーして/)
                    return true
                })
                assert.equal(calls.length, 1)
                assert.ok(calls[0].endsWith(ZAIM_WEB_MEMO_PATH))
            }
        )
    })

    it("422 は rejected（取り違えの検知を含む）", async () => {
        await withFetch(new Response("{}", { status: 422 }), async () => {
            await assert.rejects(updateZaimWebMemo(input), (error: unknown) => {
                assert.ok(error instanceof ZaimWebMemoError)
                assert.equal(error.reason, "rejected")
                return true
            })
        })
    })

    it("200 でも ok が立っていなければ成功にしない", async () => {
        await withFetch(new Response(JSON.stringify({ moneyId: 12 }), { status: 200 }), async () => {
            await assert.rejects(updateZaimWebMemo(input), ZaimWebMemoError)
        })
    })

    it("受け付けられたら moneyId と duplicated を返す", async () => {
        await withFetch(
            new Response(JSON.stringify({ ok: true, moneyId: 12, duplicated: false }), { status: 200 }),
            async () => {
                assert.deepEqual(await updateZaimWebMemo(input), { moneyId: 12, duplicated: false })
            }
        )
    })
})

async function withEnvAsync(values: Record<string, string | undefined>, run: () => Promise<void>) {
    const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
    try {
        for (const [key, value] of Object.entries(values)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
        await run()
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    }
}

/** `fetch` を差し替えて1回ぶんの応答を返す。呼ばれたURLを渡す。 */
async function withFetch(response: Response, run: (calls: string[]) => Promise<void>) {
    const calls: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (url: string | URL | Request) => {
        calls.push(String(url))
        return response
    }) as typeof fetch
    await withEnvAsync(
        { AIDE_ZAIM_WRITE_SECRET: "secret", AIDE_BASE_URL: "http://127.0.0.1:3114" },
        () => run(calls)
    )
    globalThis.fetch = original
}
