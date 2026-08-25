/**
 * Zaimの残高・保有銘柄をAIDEの読み取りAPIから受け取る（Issue #191）。
 *
 * 巡回・パースはAIDE（`guchi-apps/aide`）の責務で、asset-manager は
 * 日次で巡回済みのキャッシュを `GET /api/money/summary` から読むだけにしている。
 * 以前はここでPlaywrightのヘッドレスChromiumを起動しており、ボタンを押すたびに
 * 十数秒かかっていた（AIDEの README「asset-manager との境界」）。
 *
 * **鮮度の判断はこちら側で行う。** AIDEは「古いから返さない」という判断をせず、
 * 取得時刻（`fetchedAt`）と経過分数（`ageMinutes`）を必ず併せて返す。
 */

import type { ZaimFreshness, ZaimOnlineAccount } from "./zaim-freshness"

/** AIDEは同じVPS上の127.0.0.1で待ち受けている。外向けのURLを経由する必要はない。 */
export const DEFAULT_AIDE_BASE_URL = "http://127.0.0.1:3114"

/** キャッシュを読むだけなので待たされることは無い。詰まったら諦めて画面へ返す。 */
const REQUEST_TIMEOUT_MS = 10_000

export interface ZaimBalance {
    name: string
    amount: number
    /**
     * Zaim側が金融機関から残高を取得した時刻（ISO8601）。連携していない口座は null。
     * **AIDEが巡回した時刻とは別物**で、巡回が新しくても中身が何日も前ということがある。
     */
    lastUpdatedAt: string | null
}

export interface ZaimHolding {
    /** 証券口座名。同じ銘柄を口座ごとに分けて対応付けるために保持する。 */
    account: string
    name: string
    amount: number
    /**
     * 同一口座内に同名の銘柄が複数行ある場合の出現順（1始まり）。
     * Zaimは旧NISA・新NISA等の口座区分を表示しないため、行の順番でしか区別できない。
     */
    occurrence: number
    /** 同一口座内にある同名の行数。1なら順番指定は不要。 */
    occurrenceCount: number
    /** その銘柄が属する証券口座の最終更新時刻（ISO8601）。読めなければ null。 */
    lastUpdatedAt: string | null
}

/**
 * 対応付けに使う取得結果。
 *
 * 行ごとの `lastUpdatedAt` も保持する。定期実行は「最終更新が記録日でない行から来た値」を
 * 保存しないため、口座名の突き合わせではなく反映元の行そのものの鮮度が要る
 * （`口座名/銘柄名` を使わない alias では、`staleAccounts` の口座名と対応付けられない）。
 * 画面の警告に使う「最終更新が当日でない連携口座」は、従来どおり `staleAccounts` で受け取る。
 */
export interface ZaimSnapshot {
    balances: ZaimBalance[]
    holdings: ZaimHolding[]
}

export interface ZaimAideSnapshot extends ZaimFreshness {
    snapshot: ZaimSnapshot
}

export type ZaimAideErrorReason =
    /** asset-manager 側に AIDE_READ_SECRET が無い */
    | "notConfigured"
    /** AIDE側にシークレットが無く、読み取り口が開いていない（503） */
    | "unavailable"
    /** シークレットが違う（401） */
    | "unauthorized"
    /** 接続できない・応答が壊れている */
    | "unreachable"

export class ZaimAideError extends Error {
    constructor(
        readonly reason: ZaimAideErrorReason,
        message: string
    ) {
        super(message)
        this.name = "ZaimAideError"
    }
}

export interface ZaimAideConfig {
    baseUrl: string
    secret: string
}

/** 未設定なら null。呼び出し側は「AIDE連携が設定されていない」として扱う。 */
export function getZaimAideConfig(): ZaimAideConfig | null {
    const secret = process.env.AIDE_READ_SECRET
    if (!secret) return null
    // 末尾の「/」を落とす。付いたままだと `//api/money/summary` になる。
    const baseUrl = (process.env.AIDE_BASE_URL || DEFAULT_AIDE_BASE_URL).replace(/\/+$/, "")
    return { baseUrl, secret }
}

/** AIDE連携が設定されているか。画面・スクリプトの前提チェックに使う。 */
export function isZaimAideConfigured(): boolean {
    return getZaimAideConfig() !== null
}

function toNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null
}

function toText(value: unknown): string {
    return typeof value === "string" ? value.trim() : ""
}

function toTimestamp(value: unknown): string | null {
    const text = toText(value)
    return text || null
}

function parseAccounts(value: unknown): ZaimOnlineAccount[] {
    if (!Array.isArray(value)) return []
    return value.flatMap((item) => {
        const record = item as Record<string, unknown>
        const name = toText(record?.name)
        if (!name) return []
        return [{ name, lastUpdatedAt: toTimestamp(record?.lastUpdatedAt) }]
    })
}

/**
 * `GET /api/money/summary` の応答を取得結果へ畳む。**純粋関数。**
 *
 * 金額はAIDE側で数値化済みなので、ここでは形の検証だけを行う。名称や金額が欠けた行は
 * 対応付けようがないため落とす（1行の欠けで取得全体を失敗させない）。
 */
export function parseMoneySummary(payload: unknown): ZaimAideSnapshot {
    const summary = payload as Record<string, unknown>
    if (!summary || typeof summary !== "object") {
        throw new ZaimAideError("unreachable", "AIDEの応答を解釈できませんでした")
    }

    const rawBalances = Array.isArray(summary.balances) ? summary.balances : []
    const rawHoldings = Array.isArray(summary.holdings) ? summary.holdings : []

    const balances: ZaimBalance[] = rawBalances.flatMap((item) => {
        const record = item as Record<string, unknown>
        const name = toText(record?.name)
        const amount = toNumber(record?.amount)
        if (!name || amount === null) return []
        return [{ name, amount, lastUpdatedAt: toTimestamp(record?.lastUpdatedAt) }]
    })

    const holdings: ZaimHolding[] = rawHoldings.flatMap((item) => {
        const record = item as Record<string, unknown>
        const account = toText(record?.account)
        const name = toText(record?.name)
        const amount = toNumber(record?.amount)
        if (!account || !name || amount === null) return []
        return [
            {
                account,
                name,
                amount,
                // 古い形のキャッシュには出現順が無い。1件だけの行として扱う。
                occurrence: toNumber(record?.occurrence) ?? 1,
                occurrenceCount: toNumber(record?.occurrenceCount) ?? 1,
                lastUpdatedAt: toTimestamp(record?.lastUpdatedAt),
            },
        ]
    })

    return {
        snapshot: { balances, holdings },
        fetchedAt: toTimestamp(summary.fetchedAt),
        ageMinutes: toNumber(summary.ageMinutes),
        stale: summary.stale === true,
        empty: summary.empty === true,
        staleAccounts: parseAccounts(summary.staleAccounts),
    }
}

/** 取得できなかった理由を、画面にそのまま出せる日本語にする。 */
export function describeZaimAideError(reason: ZaimAideErrorReason): string {
    switch (reason) {
        case "notConfigured":
            return "AIDE連携が設定されていません（AIDE_READ_SECRET）"
        case "unavailable":
            return "AIDE側の読み取りAPIが有効になっていません"
        case "unauthorized":
            return "AIDEの読み取りキーが受け付けられませんでした"
        case "unreachable":
            return "AIDEへ接続できませんでした"
    }
}

/**
 * AIDEから残高・保有銘柄を取得する。**キャッシュを読むだけで、Zaimへは取りに行かない。**
 *
 * キャッシュが空でもエラーにしない（`empty: true` で返る）。まだ一度も巡回していないのは
 * 状態であってエラーではなく、呼び出し側が区別できる形で伝わればよい。
 */
export async function fetchZaimSnapshotFromAide(): Promise<ZaimAideSnapshot> {
    const config = getZaimAideConfig()
    if (!config) {
        throw new ZaimAideError("notConfigured", describeZaimAideError("notConfigured"))
    }

    let response: Response
    try {
        response = await fetch(`${config.baseUrl}/api/money/summary`, {
            headers: { Authorization: `Bearer ${config.secret}` },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            cache: "no-store",
        })
    } catch {
        throw new ZaimAideError(
            "unreachable",
            `${describeZaimAideError("unreachable")}: ${config.baseUrl}`
        )
    }

    if (response.status === 401) {
        throw new ZaimAideError("unauthorized", describeZaimAideError("unauthorized"))
    }
    if (response.status === 503) {
        throw new ZaimAideError("unavailable", describeZaimAideError("unavailable"))
    }
    if (!response.ok) {
        throw new ZaimAideError(
            "unreachable",
            `AIDEが${response.status}を返しました: GET ${config.baseUrl}/api/money/summary`
        )
    }

    try {
        return parseMoneySummary(await response.json())
    } catch (cause) {
        if (cause instanceof ZaimAideError) throw cause
        throw new ZaimAideError("unreachable", "AIDEの応答を解釈できませんでした")
    }
}
