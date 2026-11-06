import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    parseAccountLinkInput,
    resolveAccountLink,
    summarizeByAccount,
    toAccountLinkColumns,
    type LedgerAccountRef,
    type AccountLinkView,
} from "./subscription-account-link"

const accounts = new Map<number, LedgerAccountRef>([
    [101, { id: 101, name: "三井住友カード(VISA)", hidden: false }],
    [102, { id: 102, name: "旧ANAカード", hidden: true }],
])

describe("resolveAccountLink", () => {
    it("takes the account name from the ledger account, so a rename follows automatically", () => {
        const link = resolveAccountLink({ ledgerAccountId: 101, noZaimAccount: false }, accounts)
        assert.deepEqual(link, {
            status: "LINKED",
            ledgerAccountId: 101,
            ledgerAccountName: "三井住友カード(VISA)",
            ledgerAccountActive: true,
        })
        const renamed = new Map(accounts).set(101, { id: 101, name: "三井住友カード NL", hidden: false })
        assert.equal(resolveAccountLink({ ledgerAccountId: 101, noZaimAccount: false }, renamed).ledgerAccountName, "三井住友カード NL")
    })

    it("keeps the link but reports it inactive when the account is hidden or missing", () => {
        assert.equal(resolveAccountLink({ ledgerAccountId: 102, noZaimAccount: false }, accounts).ledgerAccountActive, false)
        const missing = resolveAccountLink({ ledgerAccountId: 999, noZaimAccount: false }, accounts)
        assert.equal(missing.status, "LINKED")
        assert.equal(missing.ledgerAccountId, 999)
        assert.equal(missing.ledgerAccountName, null)
        assert.equal(missing.ledgerAccountActive, false)
    })

    it("distinguishes 'no account' from 'not set yet'", () => {
        assert.equal(resolveAccountLink({ ledgerAccountId: null, noZaimAccount: true }, accounts).status, "NO_ACCOUNT")
        assert.equal(resolveAccountLink({ ledgerAccountId: null, noZaimAccount: false }, accounts).status, "UNSET")
    })
})

describe("parseAccountLinkInput / toAccountLinkColumns", () => {
    it("reads select values", () => {
        assert.deepEqual(parseAccountLinkInput("unset"), { ok: true, value: { kind: "UNSET" } })
        assert.deepEqual(parseAccountLinkInput("none"), { ok: true, value: { kind: "NO_ACCOUNT" } })
        assert.deepEqual(parseAccountLinkInput("101"), { ok: true, value: { kind: "ACCOUNT", ledgerAccountId: 101 } })
        assert.deepEqual(parseAccountLinkInput(101), { ok: true, value: { kind: "ACCOUNT", ledgerAccountId: 101 } })
    })

    it("rejects anything else", () => {
        for (const value of ["", "0", "-1", "1.5", "abc", 0, -3, 1.5, null, undefined, {}]) {
            assert.equal(parseAccountLinkInput(value).ok, false, String(value))
        }
    })

    it("never sets both columns at once", () => {
        assert.deepEqual(toAccountLinkColumns({ kind: "ACCOUNT", ledgerAccountId: 5 }), {
            ledgerAccountId: 5,
            zaimAccountId: null,
            noZaimAccount: false,
        })
        assert.deepEqual(toAccountLinkColumns({ kind: "NO_ACCOUNT" }), { ledgerAccountId: null, zaimAccountId: null, noZaimAccount: true })
        assert.deepEqual(toAccountLinkColumns({ kind: "UNSET" }), { ledgerAccountId: null, zaimAccountId: null, noZaimAccount: false })
    })
})

describe("summarizeByAccount", () => {
    const card: AccountLinkView = resolveAccountLink({ ledgerAccountId: 101, noZaimAccount: false }, accounts)
    const none: AccountLinkView = resolveAccountLink({ ledgerAccountId: null, noZaimAccount: true }, accounts)
    const unset: AccountLinkView = resolveAccountLink({ ledgerAccountId: null, noZaimAccount: false }, accounts)

    it("groups methods that end up on the same account (e.g. iTunes and the card itself)", () => {
        const rows = summarizeByAccount([
            { name: "Netflix", status: "AUTO_RENEWING", monthlyAmountJpy: 1500, accountLink: card },
            { name: "iCloud", status: "SCHEDULED_TO_END", monthlyAmountJpy: 400, accountLink: card },
            { name: "団体保険", status: "AUTO_RENEWING", monthlyAmountJpy: 2000, accountLink: none },
            { name: "謎の請求", status: "AUTO_RENEWING", monthlyAmountJpy: null, accountLink: unset },
            { name: "解約済み", status: "ENDED", monthlyAmountJpy: 9999, accountLink: card },
        ])
        assert.deepEqual(
            rows.map((row) => [row.status, row.ledgerAccountName, row.activeCount, row.monthlyTotalJpy]),
            [
                ["NO_ACCOUNT", null, 1, 2000],
                ["LINKED", "三井住友カード(VISA)", 2, 1900],
                ["UNSET", null, 1, 0],
            ]
        )
        assert.deepEqual(rows[1].subscriptionNames, ["Netflix", "iCloud"])
    })
})
