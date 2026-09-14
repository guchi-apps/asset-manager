import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { DEFAULT_AIDE_BASE_URL } from "./zaim-aide"
import {
    buildGenreSuggestionRequestId,
    buildZaimWebGenreBody,
    getZaimWebGenreConfig,
    parseZaimWebGenreResponse,
    ZaimWebGenreError,
    type ZaimWebGenreInput,
} from "./zaim-web-genre"

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

describe("getZaimWebGenreConfig", () => {
    it("AIDE_ZAIM_WRITE_SECRET が無ければ null を返す", () => {
        withEnv({ AIDE_ZAIM_WRITE_SECRET: undefined, AIDE_BASE_URL: undefined }, () => {
            assert.equal(getZaimWebGenreConfig(), null)
        })
    })

    it("Web版登録（#302）と同じシークレットを使う", () => {
        withEnv(
            { AIDE_ZAIM_WRITE_SECRET: "write-secret", AIDE_BASE_URL: undefined },
            () => {
                assert.deepEqual(getZaimWebGenreConfig(), {
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
                assert.equal(getZaimWebGenreConfig()?.baseUrl, "http://127.0.0.1:9999")
            }
        )
    })
})

describe("parseZaimWebGenreResponse", () => {
    it("moneyId と duplicated を取り出す", () => {
        assert.deepEqual(
            parseZaimWebGenreResponse({ ok: true, moneyId: 10212021703, duplicated: false }),
            { moneyId: 10212021703, duplicated: false }
        )
    })

    it("ok が true でない応答は成功として扱わない", () => {
        for (const payload of [null, {}, { ok: false }, { moneyId: 1 }, "ok"]) {
            assert.throws(() => parseZaimWebGenreResponse(payload), ZaimWebGenreError)
        }
    })

    it("moneyId が数値でない応答は成功として扱わない（書き換えたかどうかを確認できない）", () => {
        for (const payload of [
            { ok: true, moneyId: null, duplicated: false },
            { ok: true, duplicated: false },
            { ok: true, moneyId: 0, duplicated: false },
        ]) {
            assert.throws(() => parseZaimWebGenreResponse(payload), ZaimWebGenreError)
        }
    })
})

describe("ZaimWebGenreError", () => {
    it("conflict と rejected は機械が送り直さない（Web版登録#302・#335と同じ扱い）", () => {
        assert.equal(new ZaimWebGenreError("conflict", "x").retryable, false)
        assert.equal(new ZaimWebGenreError("rejected", "x").retryable, false)
        assert.equal(new ZaimWebGenreError("unreachable", "x").retryable, true)
    })

    it("notImplemented（受け口が無い）は送り直しても同じところで止まる", () => {
        // aide#273のデプロイ前は404がここに入る。unreachableに丸めるとretryable=trueになり、
        // 何度押しても直らないボタンに戻ってしまう（Issue #421の計画レビュー指摘1）。
        assert.equal(new ZaimWebGenreError("notImplemented", "x").retryable, false)
    })
})

describe("buildZaimWebGenreBody", () => {
    const input: ZaimWebGenreInput = {
        requestId: "asset-manager:genre-suggestion:42",
        moneyId: 10212021703,
        date: "2026-09-02",
        amount: 1280,
        categoryName: "食費",
        genreName: "食料品",
    }

    it("カテゴリと内訳を名前で送る（AIDEの編集画面はIDを受け取らない・Issue #335と同じ方針）", () => {
        assert.deepEqual(buildZaimWebGenreBody(input), {
            requestId: "asset-manager:genre-suggestion:42",
            moneyId: 10212021703,
            date: "2026-09-02",
            amount: 1280,
            categoryName: "食費",
            genreName: "食料品",
        })
    })

    it("AIDEが必須にしている項目を落とさない", () => {
        // 落とすと 400 で止まり、Zaimへは1件も反映されない。
        const body = buildZaimWebGenreBody(input)
        for (const key of ["moneyId", "date", "amount", "categoryName", "genreName"]) {
            assert.notEqual(body[key], undefined, key + " が本文に無い")
        }
    })
})

describe("buildGenreSuggestionRequestId", () => {
    it("提案のidから冪等キーを作る", () => {
        assert.equal(buildGenreSuggestionRequestId(42), "asset-manager:genre-suggestion:42")
    })
})
