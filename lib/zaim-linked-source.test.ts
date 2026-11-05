import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    buildSourceByAccountName,
    linkedSourceOfName,
    resolveLinkedSourceAccounts,
} from "./zaim-linked-source"

/** 実際のZaim口座一覧（Web版の表記）から、判定に関係するものを抜き出したもの。 */
const names = ["財布", "反映待ち", "Amazon.co.jp", "スマートレシート", "楽天カード", "楽天市場"]

describe("linkedSourceOfName", () => {
    it("口座名の語でスマートレシートとAmazonを分ける", () => {
        assert.equal(linkedSourceOfName("スマートレシート"), "SMART_RECEIPT")
        assert.equal(linkedSourceOfName("Smart Receipt"), "SMART_RECEIPT")
        assert.equal(linkedSourceOfName("Amazon.co.jp"), "AMAZON")
        assert.equal(linkedSourceOfName("ＡＭＡＺＯＮ"), "AMAZON")
        assert.equal(linkedSourceOfName("楽天市場"), null)
        assert.equal(linkedSourceOfName("楽天カード"), null)
    })
})

describe("resolveLinkedSourceAccounts", () => {
    it("対応が無ければ推定で、スマートレシート・Amazonの口座名を拾う", () => {
        assert.deepEqual(resolveLinkedSourceAccounts(names), [
            { source: "SMART_RECEIPT", accountName: "スマートレシート" },
            { source: "AMAZON", accountName: "Amazon.co.jp" },
        ])
    })

    it("反映待ち・楽天市場は情報源でも連携の取り込み元にしない", () => {
        const resolved = resolveLinkedSourceAccounts(names)
        assert.equal(resolved.some((a) => a.accountName === "反映待ち" || a.accountName === "楽天市場"), false)
    })

    it("口座名の対応で「口座」にした名前からは取り込まない", () => {
        const resolved = resolveLinkedSourceAccounts(names, [{ externalName: "Amazon.co.jp", target: "ACCOUNT" }])
        assert.deepEqual(resolved.map((a) => a.source), ["SMART_RECEIPT"])
    })

    it("口座名の対応で「情報源」にした名前は、語で由来が決まれば拾う", () => {
        const resolved = resolveLinkedSourceAccounts(["アマゾン 連携"], [{ externalName: "アマゾン 連携", target: "INFO_SOURCE" }])
        assert.deepEqual(resolved, [{ source: "AMAZON", accountName: "アマゾン 連携" }])
    })

    it("情報源でも由来を語で決められない名前は返さない", () => {
        assert.deepEqual(resolveLinkedSourceAccounts(["連携サービス"], [{ externalName: "連携サービス", target: "INFO_SOURCE" }]), [])
    })

    it("同じ連携の口座名が複数あればどれも返す（明細idで重複を除くので取り違えない）", () => {
        const resolved = resolveLinkedSourceAccounts(["スマートレシート", "スマートレシート (旧)", "スマートレシート"])
        assert.deepEqual(resolved.map((a) => a.accountName), ["スマートレシート", "スマートレシート (旧)"])
    })

    it("口座名が1つも無ければ空", () => {
        assert.deepEqual(resolveLinkedSourceAccounts([]), [])
    })
})

describe("buildSourceByAccountName", () => {
    it("口座名から由来を引く", () => {
        const map = buildSourceByAccountName(resolveLinkedSourceAccounts(names))
        assert.equal(map.get("スマートレシート"), "SMART_RECEIPT")
        assert.equal(map.get("Amazon.co.jp"), "AMAZON")
        assert.equal(map.get("楽天カード"), undefined)
    })
})
