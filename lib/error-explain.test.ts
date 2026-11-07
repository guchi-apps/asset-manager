import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
    CHUNK_RELOAD_COOLDOWN_MS,
    classifyError,
    errorDetailRows,
    explainError,
    formatErrorDetails,
    shouldAutoReload,
} from "./error-explain"

describe("classifyError", () => {
    it("アプリ更新後のチャンク読み込み失敗を chunk と判定する", () => {
        assert.equal(classifyError({ name: "ChunkLoadError", message: "Loading chunk 123 failed." }), "chunk")
        assert.equal(classifyError({ name: "Error", message: "Loading chunk app/page failed." }), "chunk")
        assert.equal(
            classifyError({ name: "TypeError", message: "Failed to fetch dynamically imported module: https://x/a.js" }),
            "chunk",
        )
        assert.equal(classifyError({ name: "TypeError", message: "Importing a module script failed." }), "chunk")
    })

    it("通信の失敗を network と判定する（ブラウザごとの文言）", () => {
        assert.equal(classifyError({ name: "TypeError", message: "Failed to fetch" }), "network")
        assert.equal(classifyError({ name: "TypeError", message: "Load failed" }), "network")
        assert.equal(
            classifyError({ name: "TypeError", message: "NetworkError when attempting to fetch resource." }),
            "network",
        )
    })

    it("「Load failed」を含むだけの別の文言は network にしない", () => {
        assert.equal(classifyError({ name: "Error", message: "Image Load failed for receipt" }), "render")
    })

    it("内容が伏せられたサーバーのエラーと digest 付きのエラーを server と判定する", () => {
        assert.equal(
            classifyError({
                name: "Error",
                message: "An error occurred in the Server Components render. The specific message is omitted in production builds",
                digest: "123",
            }),
            "server",
        )
        assert.equal(classifyError({ name: "Error", message: "boom", digest: "456" }), "server")
    })

    it("それ以外は render と判定する", () => {
        assert.equal(classifyError({ name: "TypeError", message: "Cannot read properties of undefined (reading 'x')" }), "render")
        assert.equal(classifyError({}), "render")
    })
})

describe("explainError", () => {
    it("種類に応じた日本語の説明を返す", () => {
        const result = explainError({ name: "TypeError", message: "Failed to fetch" })
        assert.equal(result.kind, "network")
        assert.equal(result.label, "通信のエラー")
        assert.match(result.cause, /通信/)
    })
})

describe("errorDetailRows / formatErrorDetails", () => {
    it("空の項目を省いて並べ、コピー用に1行1項目へ整形する", () => {
        const rows = errorDetailRows(
            { name: "TypeError", message: "Failed to fetch" },
            { pathname: "/", occurredAt: "2026/11/07 00:42:13", version: "8.14.0" },
        )
        assert.deepEqual(
            rows.map((row) => row.label),
            ["種類", "内容", "画面", "日時", "バージョン"],
        )
        assert.equal(
            formatErrorDetails(rows),
            "種類: TypeError\n内容: Failed to fetch\n画面: /\n日時: 2026/11/07 00:42:13\nバージョン: v8.14.0",
        )
    })
})

describe("shouldAutoReload", () => {
    const now = 1_000_000_000

    it("更新由来のエラーで、まだ試していなければ再読み込みする", () => {
        assert.equal(shouldAutoReload("chunk", null, now), true)
    })

    it("直近に試していれば再読み込みしない（ループ防止）", () => {
        assert.equal(shouldAutoReload("chunk", now - 1000, now), false)
        assert.equal(shouldAutoReload("chunk", now - CHUNK_RELOAD_COOLDOWN_MS - 1, now), true)
    })

    it("更新由来以外では再読み込みしない", () => {
        assert.equal(shouldAutoReload("network", null, now), false)
        assert.equal(shouldAutoReload("render", null, now), false)
    })
})
