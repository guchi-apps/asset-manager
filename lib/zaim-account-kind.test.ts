import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    buildAccountKindClues,
    buildAccountKindLookup,
    guessAccountKind,
    isLinkedEntryKind,
    isReplaceableKind,
    isUnreplaceableLookup,
    type AccountKindClue,
} from "./zaim-account-kind"
import type { ReplaceTarget } from "./replace-target"

const unknown: AccountKindClue = { linked: null, negative: null }

describe("guessAccountKind", () => {
    it("口座名の語から推定する", () => {
        const cases: Array<[string, string | null]> = [
            ["楽天カード", "CARD"],
            ["三井住友カード（NL）", "CARD"],
            ["Amazon Mastercard", "CARD"],
            ["モバイルSuica", "CARD"],
            ["PayPay", "CARD"],
            ["楽天ペイ", "CARD"],
            ["住信SBIネット銀行", "BANK"],
            ["ゆうちょ", "BANK"],
            ["Sony Bank WALLET", "BANK"],
            ["楽天銀行デビットカード", "BANK"],
            ["Amazon.co.jp", "OTHER"],
            ["スマートレシート", "OTHER"],
            ["SBI証券", "OTHER"],
            ["楽天ポイント", "OTHER"],
            ["お財布", "MANUAL"],
            ["反映待ち", "PENDING"],
            ["なにかの口座", null],
        ]
        for (const [name, expected] of cases) {
            assert.equal(guessAccountKind(name, unknown), expected, name)
        }
    })

    it("「デビットカード」はカードより先に銀行・デビットへ寄せる", () => {
        assert.equal(guessAccountKind("JCBデビット", unknown), "BANK")
    })

    it("名前で決まらず、連携していない口座は手入力", () => {
        assert.equal(guessAccountKind("生活費", { linked: false, negative: false }), "MANUAL")
    })

    it("名前で決まらず、連携していて残高がマイナスならカード", () => {
        assert.equal(guessAccountKind("VIEW", { linked: true, negative: true }), "CARD")
    })

    it("連携していて残高がプラスなら決めない（銀行かカードか分からない）", () => {
        assert.equal(guessAccountKind("なにかの口座", { linked: true, negative: false }), null)
    })

    it("名前の語は連携の有無より優先する", () => {
        assert.equal(guessAccountKind("楽天カード", { linked: false, negative: false }), "CARD")
    })
})

describe("isReplaceableKind / isLinkedEntryKind", () => {
    it("置き換えできないのは銀行・デビットだけ。未設定はカード扱い", () => {
        assert.equal(isReplaceableKind("BANK"), false)
        assert.equal(isReplaceableKind("CARD"), true)
        assert.equal(isReplaceableKind(null), true)
    })

    it("手入力・反映待ちの口座の明細は連携明細ではない", () => {
        assert.equal(isLinkedEntryKind("MANUAL"), false)
        assert.equal(isLinkedEntryKind("PENDING"), false)
        assert.equal(isLinkedEntryKind("BANK"), true)
        assert.equal(isLinkedEntryKind(null), true)
    })
})

describe("buildAccountKindLookup", () => {
    it("Web版の「(自動連携)」のような括弧書きの揺れを吸収して引く", () => {
        const kindOf = buildAccountKindLookup([
            { name: "住信SBIネット銀行", kind: "BANK" },
            { name: "楽天カード", kind: null },
        ])
        assert.equal(kindOf("住信SBIネット銀行 (自動連携)"), "BANK")
        assert.equal(kindOf("楽天カード"), null)
        assert.equal(kindOf(""), null)
    })
})

describe("buildAccountKindClues", () => {
    it("残高一覧から連携の有無と残高の符号を引く。一覧に無い口座は null", () => {
        const clueOf = buildAccountKindClues([
            { name: "楽天カード", amount: -12000, lastUpdatedAt: "2026-09-17T10:00:00+09:00" },
            { name: "お財布", amount: 3000, lastUpdatedAt: null },
        ])
        assert.deepEqual(clueOf("楽天カード"), { linked: true, negative: true })
        assert.deepEqual(clueOf("お財布"), { linked: false, negative: false })
        assert.deepEqual(clueOf("ほか"), { linked: null, negative: null })
        assert.deepEqual(buildAccountKindClues(null)("楽天カード"), { linked: null, negative: null })
    })
})

describe("isUnreplaceableLookup", () => {
    const target = (accountKind: ReplaceTarget["accountKind"]): ReplaceTarget => ({
        id: 1,
        date: "2026-09-15",
        amount: 5620,
        account: "口座",
        place: "ENEOS",
        name: null,
        sameAccount: null,
        accountKind,
    })

    it("候補がすべて銀行・デビットなら true", () => {
        assert.equal(isUnreplaceableLookup({ state: "found", targets: [target("BANK")] }), true)
    })

    it("置き換えできる候補が1件でもあれば false", () => {
        assert.equal(
            isUnreplaceableLookup({ state: "found", targets: [target("BANK"), target(null)] }),
            false
        )
    })

    it("候補が無ければ false", () => {
        assert.equal(isUnreplaceableLookup({ state: "notFound", targets: [] }), false)
        assert.equal(isUnreplaceableLookup(undefined), false)
    })
})
