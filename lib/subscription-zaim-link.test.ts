import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    parseZaimLinkInput,
    resolveZaimLink,
    summarizeByZaimAccount,
    toZaimLinkColumns,
    type ZaimAccountRef,
    type ZaimLinkView,
} from "./subscription-zaim-link"

const accounts = new Map<number, ZaimAccountRef>([
    [101, { zaimAccountId: 101, name: "三井住友カード(VISA)", active: true }],
    [102, { zaimAccountId: 102, name: "旧ANAカード", active: false }],
])

describe("resolveZaimLink", () => {
    it("takes the account name from the Zaim master, so a rename follows automatically", () => {
        const link = resolveZaimLink({ zaimAccountId: 101, noZaimAccount: false }, accounts)
        assert.deepEqual(link, {
            status: "LINKED",
            zaimAccountId: 101,
            zaimAccountName: "三井住友カード(VISA)",
            zaimAccountActive: true,
        })
        const renamed = new Map(accounts).set(101, { zaimAccountId: 101, name: "三井住友カード NL", active: true })
        assert.equal(resolveZaimLink({ zaimAccountId: 101, noZaimAccount: false }, renamed).zaimAccountName, "三井住友カード NL")
    })

    it("keeps the link but reports it inactive when the account is disabled or missing", () => {
        assert.equal(resolveZaimLink({ zaimAccountId: 102, noZaimAccount: false }, accounts).zaimAccountActive, false)
        const missing = resolveZaimLink({ zaimAccountId: 999, noZaimAccount: false }, accounts)
        assert.equal(missing.status, "LINKED")
        assert.equal(missing.zaimAccountId, 999)
        assert.equal(missing.zaimAccountName, null)
        assert.equal(missing.zaimAccountActive, false)
    })

    it("distinguishes 'no Zaim account' from 'not set yet'", () => {
        assert.equal(resolveZaimLink({ zaimAccountId: null, noZaimAccount: true }, accounts).status, "NO_ACCOUNT")
        assert.equal(resolveZaimLink({ zaimAccountId: null, noZaimAccount: false }, accounts).status, "UNSET")
    })
})

describe("parseZaimLinkInput / toZaimLinkColumns", () => {
    it("reads select values", () => {
        assert.deepEqual(parseZaimLinkInput("unset"), { ok: true, value: { kind: "UNSET" } })
        assert.deepEqual(parseZaimLinkInput("none"), { ok: true, value: { kind: "NO_ACCOUNT" } })
        assert.deepEqual(parseZaimLinkInput("101"), { ok: true, value: { kind: "ACCOUNT", zaimAccountId: 101 } })
        assert.deepEqual(parseZaimLinkInput(101), { ok: true, value: { kind: "ACCOUNT", zaimAccountId: 101 } })
    })

    it("rejects anything else", () => {
        for (const value of ["", "0", "-1", "1.5", "abc", 0, -3, 1.5, null, undefined, {}]) {
            assert.equal(parseZaimLinkInput(value).ok, false, String(value))
        }
    })

    it("never sets both columns at once", () => {
        assert.deepEqual(toZaimLinkColumns({ kind: "ACCOUNT", zaimAccountId: 5 }), { zaimAccountId: 5, noZaimAccount: false })
        assert.deepEqual(toZaimLinkColumns({ kind: "NO_ACCOUNT" }), { zaimAccountId: null, noZaimAccount: true })
        assert.deepEqual(toZaimLinkColumns({ kind: "UNSET" }), { zaimAccountId: null, noZaimAccount: false })
    })
})

describe("summarizeByZaimAccount", () => {
    const card: ZaimLinkView = resolveZaimLink({ zaimAccountId: 101, noZaimAccount: false }, accounts)
    const none: ZaimLinkView = resolveZaimLink({ zaimAccountId: null, noZaimAccount: true }, accounts)
    const unset: ZaimLinkView = resolveZaimLink({ zaimAccountId: null, noZaimAccount: false }, accounts)

    it("groups methods that end up on the same account (e.g. iTunes and the card itself)", () => {
        const rows = summarizeByZaimAccount([
            { name: "Netflix", status: "AUTO_RENEWING", monthlyAmountJpy: 1500, zaimLink: card },
            { name: "iCloud", status: "SCHEDULED_TO_END", monthlyAmountJpy: 400, zaimLink: card },
            { name: "団体保険", status: "AUTO_RENEWING", monthlyAmountJpy: 2000, zaimLink: none },
            { name: "謎の請求", status: "AUTO_RENEWING", monthlyAmountJpy: null, zaimLink: unset },
            { name: "解約済み", status: "ENDED", monthlyAmountJpy: 9999, zaimLink: card },
        ])
        assert.deepEqual(
            rows.map((row) => [row.status, row.zaimAccountName, row.activeCount, row.monthlyTotalJpy]),
            [
                ["NO_ACCOUNT", null, 1, 2000],
                ["LINKED", "三井住友カード(VISA)", 2, 1900],
                ["UNSET", null, 1, 0],
            ]
        )
        assert.deepEqual(rows[1].subscriptionNames, ["Netflix", "iCloud"])
    })
})
