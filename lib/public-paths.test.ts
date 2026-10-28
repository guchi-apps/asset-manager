import { test } from "node:test"
import assert from "node:assert/strict"

import { isPublicPath } from "./public-paths"
import { APP_VERSION, APP_VERSION_PATH, buildAppVersionBody } from "./app-version"

test("/api/app-version は未ログインで取れる公開経路", () => {
    assert.equal(APP_VERSION_PATH, "/api/app-version")
    assert.equal(isPublicPath(APP_VERSION_PATH), true)
})

test("公開経路に足したのは /api/app-version だけで、似たパスは保護されたまま", () => {
    assert.equal(isPublicPath("/api/app-version/extra"), false)
    assert.equal(isPublicPath("/api/app"), false)
    assert.equal(isPublicPath("/"), false)
})

test("給与明細の代理登録API（/api/salaries/agent/ 配下）だけをセッション検証から外す", () => {
    assert.equal(isPublicPath("/api/salaries/agent/preview"), true)
    assert.equal(isPublicPath("/api/salaries/agent/commit"), true)
    assert.equal(isPublicPath("/api/salaries/agent/abc"), true)
    assert.equal(isPublicPath("/api/salaries/import-pdf"), false)
    assert.equal(isPublicPath("/api/salaries/agent"), false)
    assert.equal(isPublicPath("/salaries/new"), false)
})

test("APP_COMMIT_SHA があれば sha として返す", () => {
    assert.deepEqual(buildAppVersionBody({ APP_COMMIT_SHA: "abc123" }), { version: APP_VERSION, sha: "abc123" })
})

test("APP_COMMIT_SHA が未設定・空なら sha は null", () => {
    assert.deepEqual(buildAppVersionBody({}), { version: APP_VERSION, sha: null })
    assert.deepEqual(buildAppVersionBody({ APP_COMMIT_SHA: "" }), { version: APP_VERSION, sha: null })
    assert.deepEqual(buildAppVersionBody({ APP_COMMIT_SHA: "  " }), { version: APP_VERSION, sha: null })
})

test("version は package.json の値", () => {
    assert.match(APP_VERSION, /^\d+\.\d+\.\d+/)
})
