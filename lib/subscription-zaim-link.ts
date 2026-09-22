import type { ContractStatus } from "@/lib/subscription-billing"

/**
 * サブスクの支払い方法と、最終的に引き落とされるZaim口座の紐づけ（Issue #566）。
 *
 * 紐づけは支払い方法マスタ（`SubscriptionPaymentMethod`）の側に持つ。iTunes・Google Payのように
 * Zaimに口座が無い中継サービスも、中継先のカード口座を選べば「iTunes → 三井住友カード」として扱える。
 * 給与天引き・請求書のようにZaim口座を通らないものは「Zaim口座なし」として明示し、未設定と区別する。
 *
 * **口座は名前ではなくZaimの `account_id` で持つ。** 名前はZaimマスタのキャッシュ（`ZaimAccount`）から
 * 表示のたびに引くので、Zaimで口座名を変えても紐づけは外れない。
 */

/** LINKED: Zaim口座に紐づく／NO_ACCOUNT: Zaim口座を通らない（給与天引きなど）／UNSET: まだ決めていない */
export type ZaimLinkStatus = "LINKED" | "NO_ACCOUNT" | "UNSET"

export interface ZaimAccountRef {
    zaimAccountId: number
    name: string
    active: boolean
}

export interface ZaimLinkView {
    status: ZaimLinkStatus
    zaimAccountId: number | null
    /** Zaimマスタにある口座名。紐づいていない、またはマスタに見当たらなければ null */
    zaimAccountName: string | null
    /**
     * Zaimで口座が有効か。紐づいていなければ null。
     * マスタに見当たらない（Zaimで削除された・マスタ未取得）ときも false にする。
     */
    zaimAccountActive: boolean | null
}

export function resolveZaimLink(
    method: { zaimAccountId: number | null; noZaimAccount: boolean },
    accounts: ReadonlyMap<number, ZaimAccountRef>
): ZaimLinkView {
    if (method.zaimAccountId !== null) {
        const account = accounts.get(method.zaimAccountId)
        return {
            status: "LINKED",
            zaimAccountId: method.zaimAccountId,
            zaimAccountName: account?.name ?? null,
            zaimAccountActive: account?.active ?? false,
        }
    }
    return {
        status: method.noZaimAccount ? "NO_ACCOUNT" : "UNSET",
        zaimAccountId: null,
        zaimAccountName: null,
        zaimAccountActive: null,
    }
}

/** 画面・APIから受け取る紐づけの指定。 */
export type ZaimLinkInput =
    | { kind: "UNSET" }
    | { kind: "NO_ACCOUNT" }
    | { kind: "ACCOUNT"; zaimAccountId: number }

/**
 * `"unset"` / `"none"` / 口座id（数値または数字の文字列）を読む。
 * 画面のセレクトの値をそのまま渡せるように文字列も受ける。
 */
export function parseZaimLinkInput(value: unknown): { ok: true; value: ZaimLinkInput } | { ok: false; error: string } {
    if (value === "unset") return { ok: true, value: { kind: "UNSET" } }
    if (value === "none") return { ok: true, value: { kind: "NO_ACCOUNT" } }
    const id = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value
    if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) {
        return { ok: true, value: { kind: "ACCOUNT", zaimAccountId: id } }
    }
    return { ok: false, error: "引き落とし先のZaim口座の指定が正しくありません" }
}

/** DBへ書く列の値。`zaimAccountId` と `noZaimAccount` が同時に立たないようにここで決める。 */
export function toZaimLinkColumns(input: ZaimLinkInput): { zaimAccountId: number | null; noZaimAccount: boolean } {
    switch (input.kind) {
        case "ACCOUNT":
            return { zaimAccountId: input.zaimAccountId, noZaimAccount: false }
        case "NO_ACCOUNT":
            return { zaimAccountId: null, noZaimAccount: true }
        case "UNSET":
            return { zaimAccountId: null, noZaimAccount: false }
    }
}

export interface ZaimAccountSummary {
    status: ZaimLinkStatus
    /** LINKED のときだけ入る */
    zaimAccountId: number | null
    zaimAccountName: string | null
    /** 解約済みを除いた件数 */
    activeCount: number
    /** 解約済みを除いた月あたりの合計（円）。円換算できないものは含まない */
    monthlyTotalJpy: number
    subscriptionNames: string[]
}

/**
 * 引き落とし先のZaim口座ごとの件数と月あたりの合計（区分は問わない＝月額固定費の内訳）。
 * 解約済みは含めない。「Zaim口座なし」「未設定」もそれぞれ1行にまとめる。並びは月額の大きい順。
 */
export function summarizeByZaimAccount(
    items: {
        name: string
        status: ContractStatus
        monthlyAmountJpy: number | null
        zaimLink: ZaimLinkView
    }[]
): ZaimAccountSummary[] {
    const groups = new Map<string, ZaimAccountSummary>()
    for (const item of items) {
        if (item.status === "ENDED") continue
        const key = item.zaimLink.status === "LINKED" ? `account:${item.zaimLink.zaimAccountId}` : item.zaimLink.status
        const group = groups.get(key) ?? {
            status: item.zaimLink.status,
            zaimAccountId: item.zaimLink.zaimAccountId,
            zaimAccountName: item.zaimLink.zaimAccountName,
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
