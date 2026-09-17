/**
 * 「反映待ち」の明細について、Zaimアプリで置き換える相手（置き換え前の連携明細）を探す（Issue #443）。
 *
 * 置き換え前のカード連携明細は**公開APIからは見えない**が、AIDEが巡回したZaim Web版の一覧
 * （`lib/zaim-aide-money.ts`。#383）には出る。ここはその一覧から候補を選ぶ**純粋関数**だけを置く。
 *
 * - **置き換えが済んだかどうかは判定しない。** Web版の一覧は集計対象外かどうかを読めず、
 *   置き換え済みの元明細も一覧に残る（docs「内訳の提案」）。候補は人が的を選ぶための手がかり
 * - **一覧の生の行から選ぶ**（計画レビューの指摘）。`mergeWebMoneyEntries` は口座名をマスタで
 *   引けない行を落とすため、通すとカードがマスタに無い環境で黙って0件になる。口座は表示にしか使わない
 * - **口座では絞らない。** 登録先が請求元のカードと食い違っていても候補は出し、`sameAccount` で見分ける
 */

import { normalizeMasterName, stripTrailingParenthetical } from "./zaim-web-entries"

/** 「反映待ち」口座の名前。`ZAIM_PENDING_ACCOUNT_ID` が未設定の環境でも見分けるために使う。 */
export const PENDING_ACCOUNT_NAME = "反映待ち"

/**
 * 登録先として「反映待ち」口座を指しているか。
 *
 * **この口座へ登録した明細はZaimの置き換え候補にならない**（#300 の実測）。本番では
 * `ZAIM_PENDING_ACCOUNT_ID` を設定していないことがあるため、口座名でも判定する。
 */
export function isPendingAccount(
    account: { zaimAccountId: number; name: string },
    pendingAccountId: number | null
): boolean {
    if (pendingAccountId !== null && account.zaimAccountId === pendingAccountId) return true
    return normalizeMasterName(account.name) === PENDING_ACCOUNT_NAME
}

/** 購入日の前後何日までを候補にするか。カードの利用日と購入日は数日ずれることがある。 */
export const REPLACE_TARGET_WINDOW_DAYS = 3

/** 当アプリがWeb版へ登録した行に付けるコメントの先頭（`sendReceiptToZaim`）。候補から外す。 */
export const OWN_REGISTRATION_COMMENT_PREFIX = "Asset Manager レシート取込 #"

/** 候補を選ぶのに要る、Web版一覧の1行（`ZaimAideMoneyEntry` の一部）。 */
export interface ReplaceSourceEntry {
    id: number | null
    /** YYYY-MM-DD（JST）。 */
    date: string
    amount: number
    account: string
    toAccount: string
    place: string
    name: string
    comment: string
}

export interface ReplaceTarget {
    id: number | null
    date: string
    amount: number
    /** 出金元の口座名（Web版の表記のまま）。 */
    account: string
    place: string | null
    name: string | null
    /** 登録先のカードと同じ口座か。登録先が分からなければ false。 */
    sameAccount: boolean
}

/**
 * - `found`: 候補が見つかった
 * - `notFound`: 読めた範囲に、条件に合う明細が無い
 * - `notCovered`: 購入日の前後がAIDEの読んだ月に入っておらず、見つからなかった
 * - `unknown`: 購入日・金額が無く、探せない
 */
export type ReplaceTargetState = "found" | "notFound" | "notCovered" | "unknown"

export interface ReplaceTargetLookup {
    state: ReplaceTargetState
    targets: ReplaceTarget[]
}

export interface ReplaceTargetQuery {
    /** 購入日（YYYY-MM-DD、JST）。 */
    purchasedDate: string | null
    totalAmount: number | null
    /** 登録先カードの名前（マスタの表記）。 */
    cardAccountName: string | null
}

const DAY_MS = 86_400_000

function dayNumber(date: string): number | null {
    const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
    if (!matched) return null
    return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])) / DAY_MS
}

function monthKeyOfDayNumber(day: number): string {
    return new Date(day * DAY_MS).toISOString().slice(0, 7).replace("-", "")
}

/** JSTの `YYYYMM`。 */
export function jstMonthKey(date: Date): string {
    return date.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" }).slice(0, 7).replace("-", "")
}

/**
 * AIDEが読んだ月（`YYYYMM`）の一覧。
 *
 * 応答が `months` を持っていればそれを使う。持っていない（当月だけを読んでいた頃の）AIDEでは、
 * 巡回した時刻の月だけとみなす。巡回時刻も無ければ、いまの月にする。
 */
export function resolveCoveredMonths(
    months: readonly string[] | null,
    fetchedAt: string | null,
    now: Date
): string[] {
    if (months && months.length > 0) return [...months]
    const base = fetchedAt ? new Date(fetchedAt) : now
    return [jstMonthKey(Number.isNaN(base.getTime()) ? now : base)]
}

function accountKey(name: string): string {
    return stripTrailingParenthetical(normalizeMasterName(name))
}

/**
 * Web版の一覧から、置き換える相手の候補を選ぶ。
 *
 * 条件は「金額が総額と一致」かつ「日付が購入日の前後 `REPLACE_TARGET_WINDOW_DAYS` 日以内」。
 * 振替の行と、当アプリが登録した行（コメントの印）は外す。並びは登録先と同じ口座 → 日付の近い順。
 */
export function findReplaceTargets(
    entries: readonly ReplaceSourceEntry[],
    query: ReplaceTargetQuery,
    coveredMonths: readonly string[]
): ReplaceTargetLookup {
    const purchased = query.purchasedDate ? dayNumber(query.purchasedDate) : null
    if (purchased === null || query.totalAmount === null) {
        return { state: "unknown", targets: [] }
    }

    const cardKey = query.cardAccountName ? accountKey(query.cardAccountName) : null
    const candidates = entries.flatMap((entry) => {
        if (entry.toAccount) return []
        if (entry.comment.startsWith(OWN_REGISTRATION_COMMENT_PREFIX)) return []
        if (entry.amount !== query.totalAmount) return []
        const day = dayNumber(entry.date)
        if (day === null || Math.abs(day - purchased) > REPLACE_TARGET_WINDOW_DAYS) return []
        return [
            {
                distance: Math.abs(day - purchased),
                target: {
                    id: entry.id,
                    date: entry.date,
                    amount: entry.amount,
                    account: entry.account,
                    place: entry.place || null,
                    name: entry.name || null,
                    sameAccount: cardKey !== null && accountKey(entry.account) === cardKey,
                },
            },
        ]
    })

    candidates.sort(
        (a, b) =>
            Number(b.target.sameAccount) - Number(a.target.sameAccount) ||
            a.distance - b.distance ||
            a.target.date.localeCompare(b.target.date)
    )
    const targets = candidates.map((candidate) => candidate.target)
    if (targets.length > 0) return { state: "found", targets }

    const covered = new Set(coveredMonths)
    for (let offset = -REPLACE_TARGET_WINDOW_DAYS; offset <= REPLACE_TARGET_WINDOW_DAYS; offset++) {
        if (!covered.has(monthKeyOfDayNumber(purchased + offset))) {
            return { state: "notCovered", targets: [] }
        }
    }
    return { state: "notFound", targets: [] }
}

/**
 * 登録するときに、購入日をZaimのカード連携明細の日付へ合わせるか（Issue #455）。
 *
 * Gmailのカード利用通知などから取り込んだ購入日と、Zaimへ届いた連携明細の日付は数日ずれることがある。
 * 置き換えの相手（`findReplaceTargets` の候補）のうち**登録先と同じカードの明細がちょうど1件**のときだけ、
 * その日付を返す。同じ日なら合わせる必要が無いので null。
 *
 * **候補が2件以上なら合わせない。** 同額の買い物や、置き換え済みの元明細（Web版の一覧に残る）と
 * 取り違えると、正しかった購入日を誤った日付へ書き換えてしまうため。
 */
export function pickAlignedPurchaseDate(
    lookup: ReplaceTargetLookup,
    purchasedDate: string | null
): string | null {
    if (lookup.state !== "found" || !purchasedDate) return null
    const sameCard = lookup.targets.filter((target) => target.sameAccount)
    if (sameCard.length !== 1) return null
    const date = sameCard[0].date
    return date === purchasedDate ? null : date
}
