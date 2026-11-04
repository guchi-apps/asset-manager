/**
 * Zaimの口座・Web版一覧の行を扱う共通の小道具（Issue #443 で置き換え候補の検索のために作った）。
 *
 * Zaimへの登録・置き換え（旧運用）は Issue #823 で廃止し、置き換える相手を探す `findReplaceTargets`・
 * 購入日を合わせる `pickAlignedPurchaseDate` は削除した。ここに残るのは、カード明細との対応付け・
 * 重複の判定・取り込み明細の整理がいまも使う定数と関数だけ。
 */

import type { ZaimAccountKind } from "@prisma/client"

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

/** 当アプリがWeb版へ登録した行に付けていたコメントの先頭（旧運用の `sendReceiptToZaim`）。候補から外す。 */
export const OWN_REGISTRATION_COMMENT_PREFIX = "Asset Manager レシート取込 #"

/** Web版一覧の1行（`ZaimAideMoneyEntry` の一部）。 */
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

/** 口座名（Web版の表記のまま）→ 種別。 */
export type AccountKindOf = (accountName: string) => ZaimAccountKind | null

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

/** 口座名の比較用キー。Web版の「(自動連携)」のような括弧書きの揺れを吸収する。 */
export function accountKey(name: string): string {
    return stripTrailingParenthetical(normalizeMasterName(name))
}
