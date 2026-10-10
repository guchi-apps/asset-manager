import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_AIDE_BASE_URL } from "./zaim-aide"
import {
    buildReceiptItemRequestId,
    buildReceiptRequestId,
    buildZaimWebPaymentBody,
    registerZaimWebPayment,
    getZaimWebPaymentConfig,
    parseZaimWebPaymentResponse,
    ZaimWebPaymentError,
    type ZaimWebPaymentInput,
} from "./zaim-web-payment"

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

describe("getZaimWebPaymentConfig", () => {
    it("AIDE_ZAIM_WRITE_SECRET が無ければ null を返す", () => {
        withEnv({ AIDE_ZAIM_WRITE_SECRET: undefined, AIDE_BASE_URL: undefined }, () => {
            assert.equal(getZaimWebPaymentConfig(), null)
        })
    })

    it("読み取り用とは別のシークレットを使う（読むだけの経路へ書き込み権限を渡さない）", () => {
        withEnv(
            {
                AIDE_ZAIM_WRITE_SECRET: "write-secret",
                AIDE_READ_SECRET: "read-secret",
                AIDE_BASE_URL: undefined,
            },
            () => {
                assert.deepEqual(getZaimWebPaymentConfig(), {
                    baseUrl: DEFAULT_AIDE_BASE_URL,
                    secret: "write-secret",
                })
            }
        )
    })

    it("末尾のスラッシュを落とす（パスが // にならないようにする）", () => {
        withEnv(
            { AIDE_ZAIM_WRITE_SECRET: "secret", AIDE_BASE_URL: "http://127.0.0.1:9999/" },
            () => {
                assert.equal(getZaimWebPaymentConfig()?.baseUrl, "http://127.0.0.1:9999")
            }
        )
    })
})

describe("parseZaimWebPaymentResponse", () => {
    it("moneyId と duplicated を取り出す", () => {
        assert.deepEqual(
            parseZaimWebPaymentResponse({ ok: true, moneyId: 10212021703, duplicated: false }),
            { moneyId: 10212021703, duplicated: false, verifiedLineCount: null }
        )
    })

    it("moneyId が返らない経路では null にする（登録済みだが id 不明）", () => {
        assert.deepEqual(parseZaimWebPaymentResponse({ ok: true, duplicated: true }), {
            moneyId: null,
            duplicated: true,
            verifiedLineCount: null,
        })
    })

    it("ok が true でない応答は成功として扱わない", () => {
        for (const payload of [null, {}, { ok: false }, { moneyId: 1 }, "ok"]) {
            assert.throws(() => parseZaimWebPaymentResponse(payload), ZaimWebPaymentError)
        }
    })
})

describe("ZaimWebPaymentError", () => {
    it("conflict と rejected は機械が送り直さない", () => {
        assert.equal(new ZaimWebPaymentError("conflict", "x").retryable, false)
        assert.equal(new ZaimWebPaymentError("rejected", "x").retryable, false)
        assert.equal(new ZaimWebPaymentError("unreachable", "x").retryable, true)
    })
})

describe("buildZaimWebPaymentBody", () => {
    const input: ZaimWebPaymentInput = {
        requestId: "asset-manager:receipt-item:42",
        date: "2026-09-02",
        amount: 1280,
        name: "牛乳",
        place: "スーパー",
        categoryName: "食費",
        genreName: "食料品",
        fromAccountId: 12345,
        comment: "Asset Manager レシート取込 #7",
    }

    it("カテゴリと内訳を名前で送る（AIDEの入力画面はIDを受け取らない・Issue #335）", () => {
        assert.deepEqual(buildZaimWebPaymentBody(input), {
            requestId: "asset-manager:receipt-item:42",
            date: "2026-09-02",
            amount: 1280,
            name: "牛乳",
            place: "スーパー",
            categoryName: "食費",
            genreName: "食料品",
            fromAccountId: 12345,
            comment: "Asset Manager レシート取込 #7",
        })
    })

    it("AIDEが必須にしている項目を落とさない", () => {
        // 落とすと 400「<項目名> が必要です」で止まり、Zaimへは1件も登録されない。
        const body = buildZaimWebPaymentBody(input)
        for (const key of ["name", "place", "categoryName", "genreName", "fromAccountId"]) {
            assert.notEqual(body[key], undefined, key + " が本文に無い")
        }
    })

    it("店舗名・メモが無いときは項目ごと省く（JSONに null を載せない）", () => {
        const body = buildZaimWebPaymentBody({ ...input, place: null, comment: null })
        assert.equal(body["place"], undefined)
        assert.equal(body["comment"], undefined)
        assert.equal(JSON.stringify(body).includes("null"), false)
    })
})

describe("buildReceiptItemRequestId", () => {
    it("商品の行idから冪等キーを作る", () => {
        assert.equal(buildReceiptItemRequestId(42), "asset-manager:receipt-item:42")
    })
})

describe("buildReceiptRequestId", () => {
    it("レシートのidから冪等キーを作る（商品ごとのキーとは別の名前空間）", () => {
        assert.equal(buildReceiptRequestId(84), "asset-manager:receipt:84")
    })
})

describe("複数商品を1件として登録する（#687）", () => {
    const items = [
        { name: "玉子", amount: 199, categoryName: "食費", genreName: "食料品" },
        { name: "豚肉", amount: 365, categoryName: "食費", genreName: "食料品" },
    ]
    const input: ZaimWebPaymentInput = {
        requestId: "asset-manager:receipt:84",
        date: "2026-10-10",
        amount: 564,
        name: "玉子",
        place: "スーパー",
        categoryName: "食費",
        genreName: "食料品",
        fromAccountId: 9,
        items,
    }

    it("2行以上なら items を本文へ載せる", () => {
        assert.deepEqual(buildZaimWebPaymentBody(input)["items"], items)
    })

    it("1行以下なら items を載せない（従来の単一商品の呼び出し）", () => {
        assert.equal(buildZaimWebPaymentBody({ ...input, items: [items[0]] })["items"], undefined)
        assert.equal(buildZaimWebPaymentBody({ ...input, items: undefined })["items"], undefined)
    })

    it("AIDEが読み返した行数を取り出す", () => {
        const parsed = parseZaimWebPaymentResponse({
            ok: true,
            moneyId: null,
            registered: { verified: { lineCount: 2 } },
        })
        assert.equal(parsed.verifiedLineCount, 2)
    })

    async function withFetch(payload: unknown, run: () => Promise<void>) {
        const savedFetch = globalThis.fetch
        const saved = process.env.AIDE_ZAIM_WRITE_SECRET
        process.env.AIDE_ZAIM_WRITE_SECRET = "secret"
        globalThis.fetch = (async () =>
            new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch
        try {
            await run()
        } finally {
            globalThis.fetch = savedFetch
            if (saved === undefined) delete process.env.AIDE_ZAIM_WRITE_SECRET
            else process.env.AIDE_ZAIM_WRITE_SECRET = saved
        }
    }

    it("読み返しを経ていない複数行の応答は成功にしない", async () => {
        await withFetch({ ok: true, moneyId: null }, async () => {
            await assert.rejects(registerZaimWebPayment(input), (error: unknown) => {
                return error instanceof ZaimWebPaymentError && error.reason === "conflict"
            })
        })
    })

    it("行数が食い違う応答も成功にしない", async () => {
        await withFetch({ ok: true, registered: { verified: { lineCount: 1 } } }, async () => {
            await assert.rejects(registerZaimWebPayment(input))
        })
    })

    it("全行を読み返せた応答は成功にする", async () => {
        await withFetch({ ok: true, registered: { verified: { lineCount: 2 } } }, async () => {
            const result = await registerZaimWebPayment(input)
            assert.equal(result.verifiedLineCount, 2)
        })
    })

    it("同じ requestId の再送（duplicated）は読み返し済みとして成功にする", async () => {
        await withFetch({ ok: true, duplicated: true }, async () => {
            assert.equal((await registerZaimWebPayment(input)).duplicated, true)
        })
    })
})
