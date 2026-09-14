/**
 * Zaim Web版の編集画面で、既存明細のカテゴリ・内訳だけをAIDE経由で書き換える（Issue #421）。
 *
 * 自動連携明細（カード・スマートレシート等）は公式APIで編集できない（`lib/zaim-api.ts` の
 * `updateZaimPaymentGenre` はAPIから見える明細にしか効かない）。Web版の編集画面を操作できるのは
 * AIDE（`guchi-apps/aide`）だけで、受け口は `guchi-apps/aide#273` で追加された
 * `POST /api/zaim/payment/web/genre`。ここが持つのはHTTPの呼び出しと失敗の分類だけで、
 * 画面操作の知識は持ち込まない（`lib/zaim-web-payment.ts` と同じ方針）。
 *
 * **金額・日付・口座・品目・お店・集計対象外は変えない。** 送るのはカテゴリ・内訳の名前だけで、
 * AIDE側は編集画面を開いたときの金額・日付が本文と一致しなければ別の明細を開いたとみなして
 * 422で止める（取り違えの検知。aide#273）。
 */

import { DEFAULT_AIDE_BASE_URL } from "./zaim-aide"

/** AIDE側の受け口（aide#273）。 */
export const ZAIM_WEB_GENRE_PATH = "/api/zaim/payment/web/genre"

/** 画面操作の待ち時間。`lib/zaim-web-payment.ts` と同じ理由で長めに取る。 */
const REQUEST_TIMEOUT_MS = 180_000

export type ZaimWebGenreErrorReason =
    /** asset-manager 側に AIDE_ZAIM_WRITE_SECRET が無い */
    | "notConfigured"
    /** AIDE側にシークレット・Zaimのログイン状態が無く、受け口が開いていない（503） */
    | "unavailable"
    /** シークレットが違う（401） */
    | "unauthorized"
    /** 送った内容が受け付けられない（400） */
    | "invalid"
    /**
     * 受け口自体が無い（404）。guchi-apps/aide#273 のデプロイ前に呼ぶとここに入る（Issue #421の
     * 計画レビュー）。`unreachable` に丸めると再試行可能な一時障害に見えてしまい、
     * 何度押しても直らない「押すたびに失敗するボタン」に戻ってしまう。
     */
    | "notImplemented"
    /** Zaim側の事情で書き換えられなかった（422）。金額・日付の不一致、明細が見つからない場合を含む */
    | "rejected"
    /** 前回の結果が確定していない（409）。**送り直すと意図しない明細を書き換えかねない** */
    | "conflict"
    /** 接続できない・応答が壊れている */
    | "unreachable"

export class ZaimWebGenreError extends Error {
    constructor(
        readonly reason: ZaimWebGenreErrorReason,
        message: string
    ) {
        super(message)
        this.name = "ZaimWebGenreError"
    }

    /**
     * 同じ内容をそのまま送り直してよいか。
     *
     * `lib/zaim-web-payment.ts` の `retryable` と同じ考え方。`conflict` は前回の書き換えが
     * 成立したかどうか分からない状態なので、機械が送り直してはいけない（人がZaimを見て決める）。
     * `notImplemented`（受け口自体が無い）も、送り直しても同じところで止まるので false。
     */
    get retryable(): boolean {
        return this.reason === "unreachable"
    }
}

export interface ZaimWebGenreConfig {
    baseUrl: string
    secret: string
}

/** 未設定なら null。Web版登録（#302）と同じシークレットを使う。 */
export function getZaimWebGenreConfig(): ZaimWebGenreConfig | null {
    const secret = process.env.AIDE_ZAIM_WRITE_SECRET
    if (!secret) return null
    const baseUrl = (process.env.AIDE_BASE_URL || DEFAULT_AIDE_BASE_URL).replace(/\/+$/, "")
    return { baseUrl, secret }
}

/** Web版の内訳書き換えが使えるか。画面のチェック可否には使わない（失敗は反映結果で示す）。 */
export function isZaimWebGenreConfigured(): boolean {
    return getZaimWebGenreConfig() !== null
}

export interface ZaimWebGenreInput {
    /** 二重登録を防ぐキー。`buildGenreSuggestionRequestId` で作る。 */
    requestId: string
    /** 書き換え対象のZaim明細id。 */
    moneyId: number
    /** YYYY-MM-DD（JST）。元明細の値をそのまま渡す（取り違えの検知に使われる）。 */
    date: string
    /** 元明細の金額。同上。 */
    amount: number
    /**
     * カテゴリ名・内訳名。**IDではなく名前で渡す。**
     *
     * AIDEが操作するのはZaim Web版の編集画面で、画面はIDを受け取らない
     * （`lib/zaim-web-payment.ts` と同じ理由。Issue #335）。
     */
    categoryName: string
    genreName: string
}

export interface ZaimWebGenreResult {
    moneyId: number
    /** 同じ `requestId` で処理済みだったため、Zaimへは送っていない。 */
    duplicated: boolean
}

/** 失敗の理由を、画面にそのまま出せる日本語にする。 */
export function describeZaimWebGenreError(reason: ZaimWebGenreErrorReason): string {
    switch (reason) {
        case "notConfigured":
            return "AIDEへのZaim登録が設定されていません（AIDE_ZAIM_WRITE_SECRET）"
        case "unavailable":
            return "AIDE側のZaim登録が有効になっていません"
        case "unauthorized":
            return "AIDEの登録キーが受け付けられませんでした"
        case "invalid":
            return "書き換え内容がAIDEに受け付けられませんでした"
        case "notImplemented":
            return "AIDE側にこの受け口がまだありません（guchi-apps/aide#273のデプロイ待ち）"
        case "rejected":
            return "Zaimの明細を書き換えられませんでした（金額・日付が一致しないか、明細が見つかりません）"
        case "conflict":
            return "前回の書き換え結果が確定していません。Zaimを確認してください"
        case "unreachable":
            return "AIDEへ接続できませんでした"
    }
}

function toMessage(payload: unknown, fallback: string): string {
    const record = payload as Record<string, unknown> | null
    const error = record && typeof record.error === "string" ? record.error.trim() : ""
    return error || fallback
}

/** 提案1件に対応する冪等キー。提案のidが変わらない限り、何度送っても1件しか書き換わらない。 */
export function buildGenreSuggestionRequestId(suggestionId: number): string {
    return "asset-manager:genre-suggestion:" + suggestionId
}

/**
 * AIDEへ送るJSONを組み立てる。**純粋関数。**
 *
 * `lib/zaim-web-payment.ts` の `buildZaimWebPaymentBody` と同じく、受け口の必須項目を
 * 落としたことに後から気づけるよう切り出している（Issue #335の再発防止）。
 */
export function buildZaimWebGenreBody(input: ZaimWebGenreInput): Record<string, unknown> {
    return {
        requestId: input.requestId,
        moneyId: input.moneyId,
        date: input.date,
        amount: input.amount,
        categoryName: input.categoryName,
        genreName: input.genreName,
    }
}

/**
 * 応答を結果へ畳む。**純粋関数。**
 *
 * `ok: true` 以外は成功として扱わない。応答の形が変わったまま「書き換えできた」と記録すると、
 * 書き換わっていない明細が反映済みとして残る。
 */
export function parseZaimWebGenreResponse(payload: unknown): ZaimWebGenreResult {
    const record = payload as Record<string, unknown> | null
    if (!record || typeof record !== "object" || record.ok !== true) {
        throw new ZaimWebGenreError("unreachable", "AIDEの応答を解釈できませんでした")
    }

    const rawMoneyId = record.moneyId
    if (typeof rawMoneyId !== "number" || !Number.isFinite(rawMoneyId) || rawMoneyId <= 0) {
        throw new ZaimWebGenreError("unreachable", "AIDEの応答を解釈できませんでした")
    }

    return { moneyId: rawMoneyId, duplicated: record.duplicated === true }
}

/**
 * HTTPステータスを失敗の理由へ移す（aide#273の割り当てに合わせる）。
 *
 * **404だけは `unreachable` に丸めない。** 受け口自体がまだ無い状態（デプロイ前・パスの
 * 誤り）を、接続不達などの一時障害と区別できないと `retryable` の判定を誤る
 * （Issue #421の計画レビュー指摘1）。
 */
function reasonForStatus(status: number): ZaimWebGenreErrorReason {
    if (status === 400) return "invalid"
    if (status === 401) return "unauthorized"
    if (status === 404) return "notImplemented"
    if (status === 409) return "conflict"
    if (status === 422) return "rejected"
    if (status === 503) return "unavailable"
    return "unreachable"
}

/**
 * Web版の編集画面で、既存明細のカテゴリ・内訳だけを書き換える。
 *
 * 応答が200でも `ok: true` でなければ失敗として扱う（`parseZaimWebGenreResponse`）。
 */
export async function updateZaimWebGenre(input: ZaimWebGenreInput): Promise<ZaimWebGenreResult> {
    const config = getZaimWebGenreConfig()
    if (!config) {
        throw new ZaimWebGenreError("notConfigured", describeZaimWebGenreError("notConfigured"))
    }

    let response: Response
    try {
        response = await fetch(config.baseUrl + ZAIM_WEB_GENRE_PATH, {
            method: "POST",
            headers: {
                Authorization: "Bearer " + config.secret,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(buildZaimWebGenreBody(input)),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            cache: "no-store",
        })
    } catch {
        throw new ZaimWebGenreError(
            "unreachable",
            describeZaimWebGenreError("unreachable") + ": " + config.baseUrl
        )
    }

    let payload: unknown = null
    try {
        payload = await response.json()
    } catch {
        payload = null
    }

    if (!response.ok) {
        const reason = reasonForStatus(response.status)
        throw new ZaimWebGenreError(reason, toMessage(payload, describeZaimWebGenreError(reason)))
    }

    return parseZaimWebGenreResponse(payload)
}
