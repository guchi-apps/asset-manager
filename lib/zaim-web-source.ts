/**
 * AIDE経由でZaim Web版の明細を読み、Zaim APIの明細へ合流させる（Issue #383）。
 *
 * 取得（`lib/zaim-aide-money.ts`）と変換（`lib/zaim-web-entries.ts`）をつなぎ、マスタの
 * 読み出しだけをここでやる。**取得に失敗しても呼び出し側を止めない**のが要点で、
 * AIDEが未設定・未巡回・停止中でも、Zaim APIから読めたぶんはこれまでどおり処理できる。
 * 失敗の理由は `ZaimWebSourceStatus` として持ち回り、画面に出す。
 */

import { prisma } from "@/lib/prisma"
import type { ReceiptGenreOption } from "@/lib/receipt-analysis"
import { fetchZaimMoneyListFromAide } from "@/lib/zaim-aide-money"
import { ZaimAideError } from "@/lib/zaim-aide"
import type { CopyableMoneyEntry } from "@/lib/zaim-copy"
import type { ZaimAccountRef } from "@/lib/zaim-linked-source"
import {
    buildZaimMasterIndex,
    mergeWebMoneyEntries,
    type WebMoneyMergeBreakdown,
} from "@/lib/zaim-web-entries"

/** 何も読めなかったときの内訳。画面が常に同じ形を受け取れるようにする。 */
export const EMPTY_WEB_MERGE_BREAKDOWN: WebMoneyMergeBreakdown = {
    scanned: 0,
    merged: 0,
    duplicate: 0,
    noId: 0,
    notPayment: 0,
    unknownAccount: 0,
    unknownGenre: 0,
}

/**
 * Web版の明細をどれだけ読めたか（Issue #383）。
 *
 * **`available: false` は不具合とは限らない。** AIDE連携を設定していない環境では常にこの形になる。
 */
export interface ZaimWebSourceStatus {
    /** AIDEから明細を読めたか。 */
    available: boolean
    /** 読めなかった理由（そのまま画面に出せる日本語）。読めたなら null。 */
    reason: string | null
    /** AIDEが巡回した時刻（ISO8601）。 */
    fetchedAt: string | null
    ageMinutes: number | null
    /** AIDE側の鮮度判定。巡回間隔（1日2回）を超えていれば true。 */
    stale: boolean
    /** AIDEがまだ一度も巡回していない。 */
    empty: boolean
    breakdown: WebMoneyMergeBreakdown
}

export interface ZaimWebSourceResult {
    entries: CopyableMoneyEntry[]
    status: ZaimWebSourceStatus
}

function unavailable(reason: string): ZaimWebSourceResult {
    return {
        entries: [],
        status: {
            available: false,
            reason,
            fetchedAt: null,
            ageMinutes: null,
            stale: false,
            empty: true,
            breakdown: { ...EMPTY_WEB_MERGE_BREAKDOWN },
        },
    }
}

/**
 * 名前の突き合わせに使う口座マスタ。**有効な口座だけに絞る。**
 *
 * 呼び出し側から受け取らずここで読むのは、条件を1か所に決めるため。`collectCopyCandidates` は
 * 表示用に全口座を読み、`importLinkedReceipts` は有効な口座だけを読んでいるので、受け取ると
 * **呼び出し元によって合流結果が変わりうる**（無効化した口座と有効な口座が同名なら、
 * `buildZaimMasterIndex` はどちらか決められないとして引けなくする）。
 */
async function loadAccounts(userId: string): Promise<ZaimAccountRef[]> {
    return prisma.zaimAccount.findMany({
        where: { userId, active: true },
        select: { zaimAccountId: true, name: true },
    })
}

async function loadGenres(userId: string): Promise<ReceiptGenreOption[]> {
    const genres = await prisma.zaimGenre.findMany({
        where: { userId, active: true },
        select: { zaimGenreId: true, zaimCategoryId: true, name: true, categoryName: true },
    })
    return genres.map((genre) => ({
        zaimGenreId: genre.zaimGenreId,
        zaimCategoryId: genre.zaimCategoryId,
        genreName: genre.name,
        categoryName: genre.categoryName,
    }))
}

/**
 * AIDEが巡回したZaim Web版の明細を、Zaim APIの明細へ足せる形で返す。
 *
 * `knownMoneyIds` にはZaim APIから読めた明細idを渡す（一覧にはAPIで読める明細も並ぶため、
 * 渡さないと同じ明細が二重に候補へ出る）。**突き合わせに使うマスタは呼び出し側から受け取らず、
 * ここで読む**（`loadAccounts` のコメント参照）。
 */
export async function loadWebMoneyEntries(
    userId: string,
    options: { knownMoneyIds: ReadonlySet<number> }
): Promise<ZaimWebSourceResult> {
    let list
    try {
        list = await fetchZaimMoneyListFromAide()
    } catch (error) {
        if (error instanceof ZaimAideError) return unavailable(error.message)
        return unavailable(
            error instanceof Error ? error.message : "AIDEからZaimの明細を読めませんでした"
        )
    }

    const [accounts, genres] = await Promise.all([loadAccounts(userId), loadGenres(userId)])

    const merged = mergeWebMoneyEntries(
        list.entries,
        buildZaimMasterIndex(accounts, genres),
        { knownMoneyIds: options.knownMoneyIds }
    )

    return {
        entries: merged.entries,
        status: {
            available: true,
            reason: null,
            fetchedAt: list.fetchedAt,
            ageMinutes: list.ageMinutes,
            stale: list.stale,
            empty: list.empty,
            breakdown: merged.breakdown,
        },
    }
}
