/**
 * AIDEへ「対象1取引の商品内訳を、今Zaimから取り直す」ことを依頼する（Issue #677。AIDE側: aide#600）。
 *
 * `GET /api/money/transactions` は定期巡回（11:30 / 23:30）のキャッシュで、最大約12時間古い。
 * こちらは押した時点の最新を読ませる口で、**非同期**（受付 → ジョブを読み直す）。
 * 受付（202）は成功ではない。成功は `job.status === "succeeded"`（`fetchedAt` と `result` が付く）だけ。
 * **読むだけで、Zaimの取引の登録・更新・削除はしない。**
 *
 * 認証は読み取り用の `AIDE_READ_SECRET` ではなく、Zaimの画面を操作する側の `AIDE_ZAIM_WRITE_SECRET`
 * （`lib/zaim-web-payment.ts` と同じ）。
 */

import { parseMoneyTransactions, type ZaimAideMoneyEntry } from "@/lib/zaim-aide-money"
import { getZaimWebPaymentConfig } from "@/lib/zaim-web-payment"

const REQUEST_TIMEOUT_MS = 15_000
export const ZAIM_DETAIL_REFRESH_PATH = "/api/zaim/receipt-detail/refresh"

/** AIDEの `failure.kind` に、こちら側で判別したものを足したもの。 */
export type ZaimRefreshFailureKind =
    | "busy"
    | "session_expired"
    | "not_found"
    | "detail_failed"
    | "fetch_failed"
    | "internal"
    | "subpc_unreachable"
    | "subpc_timeout"
    | "subpc_rejected"
    | "subpc_bad_response"
    | "invalid"
    | "job_not_found"
    // こちら側で決めるもの
    | "notConfigured"
    | "unreachable"
    | "bad_response"
    | "partial"
    | "no_items"
    | "mismatch"
    | "unlinked_account"

export interface ZaimRefreshFailure {
    kind: ZaimRefreshFailureKind
    retryable: boolean
    message: string
}

export class ZaimRefreshError extends Error {
    constructor(readonly failure: ZaimRefreshFailure) {
        super(failure.message)
        this.name = "ZaimRefreshError"
    }
}

/** 失敗の種類を、画面にそのまま出せる日本語にする。AIDEが `message` を返してきたときはそれを足す。 */
export function describeRefreshFailure(kind: ZaimRefreshFailureKind, detail?: string): string {
    const text = (() => {
        switch (kind) {
            case "busy":
                return "別の取得または定期巡回が実行中です。数分後にもう一度お試しください"
            case "session_expired":
                return "Zaimのログインが切れています。サブPCで login.mjs を実行してログインし直してください"
            case "not_found":
                return "Zaimの明細に対象の取引が見つかりませんでした（日付・金額が一致しません）"
            case "detail_failed":
                return "取引は見つかりましたが、商品内訳を読み取れませんでした"
            case "fetch_failed":
                return "Zaimの画面の読み取りに失敗しました"
            case "internal":
                return "AIDE内部でエラーが起きました"
            case "subpc_unreachable":
                return "サブPCに接続できませんでした（停止中の可能性があります）。取得は始まっていません"
            case "subpc_timeout":
                return "サブPCの応答待ちで切れました。取得が始まったかは不明です"
            case "subpc_rejected":
                return "サブPCが依頼を受け付けませんでした（AIDEの更新が未反映の可能性があります）"
            case "subpc_bad_response":
                return "サブPCの応答を解釈できませんでした"
            case "invalid":
                return "依頼の内容が正しくありません"
            case "job_not_found":
                return "取得の記録が見つかりません（サブPCの再起動か期限切れ）。もう一度お試しください"
            case "notConfigured":
                return "AIDEへの依頼が設定されていません（AIDE_ZAIM_WRITE_SECRET）"
            case "unreachable":
                return "AIDEへ接続できませんでした"
            case "bad_response":
                return "AIDEの応答を解釈できませんでした"
            case "partial":
                return "商品内訳を一部しか読み取れなかったため、反映しませんでした"
            case "no_items":
                return "この取引には商品内訳がありませんでした"
            case "mismatch":
                return "AIDEの結果が依頼した取引と一致しなかったため、反映しませんでした"
            case "unlinked_account":
                return "この明細の取り込み元の口座が連携口座の設定に見つからないため、反映できません"
        }
    })()
    return detail && detail !== text ? `${text}（${detail}）` : text
}

/** 再試行してよいか。AIDEが `retryable` を返すときはそれに従い、無いときだけ種類で決める。 */
function defaultRetryable(kind: ZaimRefreshFailureKind): boolean {
    return !["session_expired", "not_found", "subpc_rejected", "invalid", "notConfigured", "partial", "no_items", "unlinked_account"].includes(kind)
}

export function makeRefreshFailure(
    kind: ZaimRefreshFailureKind,
    options: { retryable?: boolean; detail?: string } = {}
): ZaimRefreshFailure {
    return {
        kind,
        retryable: options.retryable ?? defaultRetryable(kind),
        message: describeRefreshFailure(kind, options.detail),
    }
}

export type ZaimRefreshJobStatus = "running" | "succeeded" | "failed"

export interface ZaimRefreshJob {
    jobId: string
    moneyId: number | null
    status: ZaimRefreshJobStatus
    requestedAt: string | null
    /** 今回Zaimから読み取れた時刻。`succeeded` のときだけ付く。 */
    fetchedAt: string | null
    failure: ZaimRefreshFailure | null
    /** `succeeded` のときの取引1件。商品内訳（`items`）は `itemsStatus` が `complete` のときだけ確定してよい。 */
    entry: (ZaimAideMoneyEntry & { itemsStatus: string | null }) | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function text(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null
}

const KNOWN_KINDS: readonly string[] = [
    "busy", "session_expired", "not_found", "detail_failed", "fetch_failed", "internal",
    "subpc_unreachable", "subpc_timeout", "subpc_rejected", "subpc_bad_response", "invalid", "job_not_found",
]

/** 応答の `failure` を畳む。**純粋関数。** 知らない `kind` は `internal` 扱いにして理由文を残す。 */
export function parseRefreshFailure(value: unknown): ZaimRefreshFailure | null {
    const record = asRecord(value)
    if (!record) return null
    const rawKind = text(record.kind)
    const kind = (rawKind && KNOWN_KINDS.includes(rawKind) ? rawKind : "internal") as ZaimRefreshFailureKind
    return makeRefreshFailure(kind, {
        retryable: typeof record.retryable === "boolean" ? record.retryable : undefined,
        detail: text(record.message) ?? undefined,
    })
}

/** 応答の `job` を畳む。**純粋関数。** 形が違えば `ZaimRefreshError("bad_response")`。 */
export function parseRefreshJob(payload: unknown): ZaimRefreshJob {
    const job = asRecord(asRecord(payload)?.job)
    const jobId = text(job?.jobId)
    const status = text(job?.status)
    if (!job || !jobId || (status !== "running" && status !== "succeeded" && status !== "failed")) {
        throw new ZaimRefreshError(makeRefreshFailure("bad_response"))
    }

    let entry: ZaimRefreshJob["entry"] = null
    const rawEntry = asRecord(asRecord(job.result)?.entry)
    if (status === "succeeded" && rawEntry) {
        const parsed = parseMoneyTransactions({ entries: [rawEntry] }).entries[0]
        if (parsed) entry = { ...parsed, itemsStatus: text(rawEntry.itemsStatus) }
    }

    const moneyId = typeof job.moneyId === "number" ? job.moneyId : null
    return {
        jobId,
        moneyId,
        status,
        requestedAt: text(job.requestedAt),
        // 取得時刻は成功のときだけ意味を持つ。受付・実行中・失敗の応答に付いていても使わない。
        fetchedAt: status === "succeeded" ? text(job.fetchedAt) : null,
        failure: status === "failed" ? (parseRefreshFailure(job.failure) ?? makeRefreshFailure("internal")) : null,
        entry,
    }
}

export interface RequestRefreshInput {
    moneyId: number
    /** YYYY-MM-DD（JST）。取り違えの検知用で、Zaimの取引と一致しなければ `not_found` になる。 */
    date: string
    amount: number
}

async function callAide(method: "POST" | "GET", path: string, body?: unknown): Promise<{ status: number; payload: unknown }> {
    const config = getZaimWebPaymentConfig()
    if (!config) throw new ZaimRefreshError(makeRefreshFailure("notConfigured"))

    let response: Response
    try {
        response = await fetch(config.baseUrl + path, {
            method,
            headers: {
                Authorization: "Bearer " + config.secret,
                ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            cache: "no-store",
        })
    } catch {
        throw new ZaimRefreshError(makeRefreshFailure("unreachable"))
    }

    let payload: unknown = null
    try {
        payload = await response.json()
    } catch {
        payload = null
    }
    return { status: response.status, payload }
}

/** 2xx以外の応答を失敗へ畳む。**純粋関数。** */
export function failureForHttpError(status: number, payload: unknown): ZaimRefreshFailure {
    const record = asRecord(payload)
    const fromBody = parseRefreshFailure(record?.failure ?? asRecord(record?.job)?.failure)
    if (fromBody && !(fromBody.kind === "internal" && status === 404)) return fromBody
    if (status === 404) {
        return makeRefreshFailure(text(record?.error) === "job_not_found" ? "job_not_found" : "subpc_rejected")
    }
    if (status === 401 || status === 403) return makeRefreshFailure("subpc_rejected", { detail: "認証エラー" })
    if (status === 429) return makeRefreshFailure("busy")
    if (status === 400) return makeRefreshFailure("invalid")
    return makeRefreshFailure("unreachable", { detail: `AIDEが${status}を返しました` })
}

/** 最新取得を依頼する。**受け付けただけで成功ではない**（返るのは `running` のジョブ）。 */
export async function requestDetailRefresh(input: RequestRefreshInput): Promise<ZaimRefreshJob> {
    const { status, payload } = await callAide("POST", ZAIM_DETAIL_REFRESH_PATH, input)
    if (status !== 200 && status !== 202) throw new ZaimRefreshError(failureForHttpError(status, payload))
    return parseRefreshJob(payload)
}

/** 依頼したジョブの状態を読む。404 `job_not_found` は再起動か期限切れ（依頼し直してよい）。 */
export async function fetchDetailRefreshJob(jobId: string): Promise<ZaimRefreshJob> {
    const { status, payload } = await callAide("GET", `${ZAIM_DETAIL_REFRESH_PATH}/${encodeURIComponent(jobId)}`)
    if (status !== 200) throw new ZaimRefreshError(failureForHttpError(status, payload))
    return parseRefreshJob(payload)
}
