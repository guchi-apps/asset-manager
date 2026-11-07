import type { ContractStatus } from "@/lib/subscription-billing"

/**
 * サブスクの支払い方法と、最終的に引き落とされる家計簿の口座の紐づけ（Issue #566・#878）。
 *
 * 紐づけは支払い方法マスタ（`SubscriptionPaymentMethod`）の側に持つ。iTunes・Google Payのように
 * 家計簿に口座が無い中継サービスも、中継先のカード口座を選べば「iTunes → 三井住友カード」として扱える。
 * 給与天引き・請求書のように口座を通らないものは「口座なし」として明示し、未設定と区別する。
 *
 * **口座は名前ではなく `LedgerAccount.id` で持つ。** 名前は表示のたびに `LedgerAccount` から引くので、
 * 口座名を変えても紐づけは外れない。#878 までは Zaim の `account_id`（`ZaimAccount`）で持っていた。
 */

/** LINKED: 家計簿の口座に紐づく／NO_ACCOUNT: 口座を通らない（給与天引きなど）／UNSET: まだ決めていない */
export type AccountLinkStatus = "LINKED" | "NO_ACCOUNT" | "UNSET"

export interface LedgerAccountRef {
    id: number
    name: string
    hidden: boolean
}

export interface AccountLinkView {
    status: AccountLinkStatus
    ledgerAccountId: number | null
    /** 家計簿の口座名。紐づいていない、または口座が見当たらなければ null */
    ledgerAccountName: string | null
    /**
     * 口座が使われる状態か（非表示にしていない）。紐づいていなければ null。
     * 口座が見当たらない（削除された）ときも false にする。
     */
    ledgerAccountActive: boolean | null
}

/** 口座に紐づく支払い方法の保存名。表示名は口座から引くので、口座名とは切り離した内部キーにする（Issue #985）。 */
export function accountPaymentMethodKey(ledgerAccountId: number): string {
    return `acct:${ledgerAccountId}`
}

/**
 * 支払い方法の表示名。口座に紐づく行は家計簿の口座名（口座名を変えても追従する）、
 * 口座なし・未設定の行は保存名。口座が見つからないときは口座idで示す。
 */
export function paymentMethodDisplayName(
    method: { name: string; ledgerAccountId: number | null },
    accounts: ReadonlyMap<number, LedgerAccountRef>
): string {
    if (method.ledgerAccountId === null) return method.name
    return accounts.get(method.ledgerAccountId)?.name ?? `口座id ${method.ledgerAccountId}`
}

export function resolveAccountLink(
    method: { ledgerAccountId: number | null; noZaimAccount: boolean },
    accounts: ReadonlyMap<number, LedgerAccountRef>
): AccountLinkView {
    if (method.ledgerAccountId !== null) {
        const account = accounts.get(method.ledgerAccountId)
        return {
            status: "LINKED",
            ledgerAccountId: method.ledgerAccountId,
            ledgerAccountName: account?.name ?? null,
            ledgerAccountActive: account ? !account.hidden : false,
        }
    }
    return {
        status: method.noZaimAccount ? "NO_ACCOUNT" : "UNSET",
        ledgerAccountId: null,
        ledgerAccountName: null,
        ledgerAccountActive: null,
    }
}

/** 画面・APIから受け取る紐づけの指定。 */
export type AccountLinkInput =
    | { kind: "UNSET" }
    | { kind: "NO_ACCOUNT" }
    | { kind: "ACCOUNT"; ledgerAccountId: number }

/**
 * `"unset"` / `"none"` / 口座id（数値または数字の文字列）を読む。
 * 画面のセレクトの値をそのまま渡せるように文字列も受ける。
 */
export function parseAccountLinkInput(value: unknown): { ok: true; value: AccountLinkInput } | { ok: false; error: string } {
    if (value === "unset") return { ok: true, value: { kind: "UNSET" } }
    if (value === "none") return { ok: true, value: { kind: "NO_ACCOUNT" } }
    const id = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value
    if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) {
        return { ok: true, value: { kind: "ACCOUNT", ledgerAccountId: id } }
    }
    return { ok: false, error: "引き落とし先の口座の指定が正しくありません" }
}

/**
 * DBへ書く列の値。`ledgerAccountId` と `noZaimAccount` が同時に立たないようにここで決める。
 * 旧列 `zaimAccountId` は読まないので、書き換えるときに null へ寄せて古い紐づけを残さない。
 */
export function toAccountLinkColumns(input: AccountLinkInput): {
    ledgerAccountId: number | null
    zaimAccountId: null
    noZaimAccount: boolean
} {
    switch (input.kind) {
        case "ACCOUNT":
            return { ledgerAccountId: input.ledgerAccountId, zaimAccountId: null, noZaimAccount: false }
        case "NO_ACCOUNT":
            return { ledgerAccountId: null, zaimAccountId: null, noZaimAccount: true }
        case "UNSET":
            return { ledgerAccountId: null, zaimAccountId: null, noZaimAccount: false }
    }
}

export interface AccountSummary {
    status: AccountLinkStatus
    /** LINKED のときだけ入る */
    ledgerAccountId: number | null
    ledgerAccountName: string | null
    /** 解約済みを除いた件数 */
    activeCount: number
    /** 解約済みを除いた月あたりの合計（円）。円換算できないものは含まない */
    monthlyTotalJpy: number
    subscriptionNames: string[]
}

/**
 * 引き落とし先の家計簿の口座ごとの件数と月あたりの合計（区分は問わない＝月額固定費の内訳）。
 * 解約済みは含めない。「口座なし」「未設定」もそれぞれ1行にまとめる。並びは月額の大きい順。
 */
export function summarizeByAccount(
    items: {
        name: string
        status: ContractStatus
        monthlyAmountJpy: number | null
        accountLink: AccountLinkView
    }[]
): AccountSummary[] {
    const groups = new Map<string, AccountSummary>()
    for (const item of items) {
        if (item.status === "ENDED") continue
        const key =
            item.accountLink.status === "LINKED" ? `account:${item.accountLink.ledgerAccountId}` : item.accountLink.status
        const group = groups.get(key) ?? {
            status: item.accountLink.status,
            ledgerAccountId: item.accountLink.ledgerAccountId,
            ledgerAccountName: item.accountLink.ledgerAccountName,
            activeCount: 0,
            monthlyTotalJpy: 0,
            subscriptionNames: [],
        }
        group.activeCount += 1
        group.monthlyTotalJpy += item.monthlyAmountJpy ?? 0
        group.subscriptionNames.push(item.name)
        groups.set(key, group)
    }
    return Array.from(groups.values()).sort((a, b) => b.monthlyTotalJpy - a.monthlyTotalJpy)
}
