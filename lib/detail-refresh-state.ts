/**
 * 「元の取引から再取得」の進行状況（Issue #677）。クライアントからも使うので、DB・通信には依存させない。
 *
 * AIDEへ最新取得を依頼してから、結果を商品明細へ反映するまでを4つの状態で持つ。
 * **取得開始（running）を完了として扱わない。** 反映済み（applied）になるのは、AIDEが今回の取得の成功を
 * 返し、商品明細へ置き換えたあとだけ。
 */

export type DetailRefreshStatus = "none" | "running" | "fetched" | "applied" | "failed"

export interface DetailRefreshState {
    status: DetailRefreshStatus
    requestedAt: string | null
    /** 今回Zaimから読み取れた時刻。定期巡回のキャッシュの時刻ではない。 */
    fetchedAt: string | null
    /** 失敗の理由（そのまま画面に出せる日本語）。 */
    error: string | null
    /** 失敗したとき、そのまま再試行してよいか（認証切れなど、人の操作が要るものは false）。 */
    retryable: boolean
}

export const EMPTY_DETAIL_REFRESH: DetailRefreshState = {
    status: "none",
    requestedAt: null,
    fetchedAt: null,
    error: null,
    retryable: true,
}

/**
 * 取得中のまま、この時間を超えたら諦める。AIDEの目安（30〜60秒・2分を超えたら諦めてよい）に余裕を足した値。
 * サブPCの再起動で進行中のジョブが消えたときに、画面が永遠に「取得中」のままにならないための上限。
 */
export const DETAIL_REFRESH_TIMEOUT_MS = 150_000

export const DETAIL_REFRESH_TIMEOUT_MESSAGE =
    "取得が時間内に終わりませんでした（サブPCの停止や再起動の可能性があります）。もう一度お試しください"

interface StoredRefresh {
    detailRefreshStatus: string | null
    detailRefreshRequestedAt: Date | null
    detailRefreshFetchedAt: Date | null
    detailRefreshError: string | null
    detailRefreshRetryable: boolean | null
}

const STATUSES: readonly DetailRefreshStatus[] = ["running", "fetched", "applied", "failed"]

/** 保存済みの値から画面向けの状態を作る。**純粋関数。** 取得中のまま上限を超えていれば失敗として返す。 */
export function toDetailRefreshState(row: StoredRefresh, now: Date = new Date()): DetailRefreshState {
    const status = STATUSES.find((candidate) => candidate === row.detailRefreshStatus)
    if (!status) return { ...EMPTY_DETAIL_REFRESH }

    const base: DetailRefreshState = {
        status,
        requestedAt: row.detailRefreshRequestedAt?.toISOString() ?? null,
        fetchedAt: row.detailRefreshFetchedAt?.toISOString() ?? null,
        error: row.detailRefreshError,
        retryable: row.detailRefreshRetryable ?? true,
    }
    if (status === "running" && isDetailRefreshExpired(row.detailRefreshRequestedAt, now)) {
        return { ...base, status: "failed", error: DETAIL_REFRESH_TIMEOUT_MESSAGE, retryable: true }
    }
    return base
}

export function isDetailRefreshExpired(requestedAt: Date | null, now: Date = new Date()): boolean {
    if (!requestedAt) return true
    return now.getTime() - requestedAt.getTime() > DETAIL_REFRESH_TIMEOUT_MS
}
