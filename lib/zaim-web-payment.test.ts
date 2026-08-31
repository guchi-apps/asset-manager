import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_AIDE_BASE_URL } from "./zaim-aide"
import {
    buildReceiptItemRequestId,
    getZaimWebPaymentConfig,
    parseZaimWebPaymentResponse,
    ZaimWebPaymentError,
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
            { moneyId: 10212021703, duplicated: false }
        )
    })

    it("moneyId が返らない経路では null にする（登録済みだが id 不明）", () => {
        assert.deepEqual(parseZaimWebPaymentResponse({ ok: true, duplicated: true }), {
            moneyId: null,
            duplicated: true,
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

describe("buildReceiptItemRequestId", () => {
    it("商品の行idから冪等キーを作る", () => {
        assert.equal(buildReceiptItemRequestId(42), "asset-manager:receipt-item:42")
    })
})
