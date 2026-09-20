/**
 * Zaim Web版の編集画面で、既存明細の**メモだけ**をAIDE経由で書き換える（Issue #514）。
 *
 * 銀行・デビットの連携明細はZaimの「置き換え」の対象外なので、アプリの明細で置き換えられない
 * （`lib/zaim-account-kind.ts`）。残る手は**その連携明細を直接直すこと**だけだが、自動連携明細は
 * 公式APIから編集できない（`lib/zaim-api.ts` の `updateZaimPaymentGenre` はAPIから見える明細に
 * しか効かない）。Web版の編集画面を操作できるのはAIDE（`guchi-apps/aide`）だけなので、
 * 内訳の書き戻し（`lib/zaim-web-genre.ts`。aide#273）と同じ形でAIDEへ委ねる。
 *
 * **AIDE側の受け口（`POST /api/zaim/payment/web/memo`）はまだ無い**（guchi-apps/aide#354）。受け口が出るまで
 * 404 → `notImplemented` で止まり、画面は下書きをコピーしてZaimアプリへ貼る導線だけを残す
 * （`lib/zaim-web-genre.ts` が aide#273 のデプロイを待っていたのと同じ状態）。
 *
 * **金額・日付・口座・カテゴリ・内訳・品目・お店は変えない。** 送るのはメモの本文だけで、
 * AIDE側は編集画面を開いたときの金額・日付が本文と一致しなければ別の明細を開いたとみなして
 * 422で止める（取り違えの検知。aide#273と同じ約束）。
 */

import { DEFAULT_AIDE_BASE_URL } from "./zaim-aide"
import { ZAIM_MEMO_MAX_LENGTH } from "./zaim-memo-draft"

/** AIDE側の受け口。 */
export const ZAIM_WEB_MEMO_PATH = "/api/zaim/payment/web/memo"

/** 画面操作の待ち時間。`lib/zaim-web-genre.ts` と同じ理由で長めに取る。 */
const REQUEST_TIMEOUT_MS = 180_000

export type ZaimWebMemoErrorReason =
    /** asset-manager 側に AIDE_ZAIM_WRITE_SECRET が無い */
    | "notConfigured"
    /** AIDE側にシークレット・Zaimのログイン状態が無く、受け口が開いていない（503） */
    | "unavailable"
    /** シークレットが違う（401） */
    | "unauthorized"
    /** 送った内容が受け付けられない（400） */
    | "invalid"
    /** 受け口自体が無い（404）。**いまは常にここに入る**（AIDE側が未実装。aide#354） */
    | "notImplemented"
    /** Zaim側の事情で書き換えられなかった（422）。金額・日付の不一致、明細が見つからない場合を含む */
    | "rejected"
    /** 前回の結果が確定していない（409）。送り直すと意図しない明細を書き換えかねない */
    | "conflict"
    /** 接続できない・応答が壊れている */
    | "unreachable"

export class ZaimWebMemoError extends Error {
    constructor(
        readonly reason: ZaimWebMemoErrorReason,
        message: string
    ) {
        super(message)
        this.name = "ZaimWebMemoError"
    }

    /**
     * 同じ内容をそのまま送り直してよいか。`lib/zaim-web-genre.ts` の `retryable` と同じ考え方で、
     * 結果が分からない `conflict` と、送り直しても同じところで止まる `notImplemented` は false。
     */
    get retryable(): boolean {
        return this.reason === "unreachable"
    }
}

export interface ZaimWebMemoConfig {
    baseUrl: string
    secret: string
}

/** 未設定なら null。Web版登録（#302）・内訳の書き戻し（#421）と同じシークレットを使う。 */
export function getZaimWebMemoConfig(): ZaimWebMemoConfig | null {
    const secret = process.env.AIDE_ZAIM_WRITE_SECRET
    if (!secret) return null
    const baseUrl = (process.env.AIDE_BASE_URL || DEFAULT_AIDE_BASE_URL).replace(/\/+$/, "")
    return { baseUrl, secret }
}

/** Web版のメモ書き換えが使えるか。画面のボタンを消すのには使わない（失敗は結果で示す）。 */
export function isZaimWebMemoConfigured(): boolean {
    return getZaimWebMemoConfig() !== null
}

export interface ZaimWebMemoInput {
    /** 二重書き込みを防ぐキー。`buildZaimMemoRequestId` で作る（本文が変われば変わる）。 */
    requestId: string
    /** 書き換え対象のZaim明細id。 */
    moneyId: number
    /** YYYY-MM-DD（JST）。元明細の値をそのまま渡す（取り違えの検知に使われる）。 */
    date: string
    /** 元明細の金額。同上。 */
    amount: number
    /** 書き込むメモの本文。空文字はメモを消すことを表す。 */
    comment: string
}

export interface ZaimWebMemoResult {
    moneyId: number
    /** 同じ `requestId` で処理済みだったため、Zaimへは送っていない。 */
    duplicated: boolean
}

/** 失敗の理由を、画面にそのまま出せる日本語にする。 */
export function describeZaimWebMemoError(reason: ZaimWebMemoErrorReason): string {
    switch (reason) {
        case "notConfigured":
            return "AIDEへのZaim書き込みが設定されていません（AIDE_ZAIM_WRITE_SECRET）"
        case "unavailable":
            return "AIDE側のZaim書き込みが有効になっていません"
        case "unauthorized":
            return "AIDEの登録キーが受け付けられませんでした"
        case "invalid":
            return "メモの内容がAIDEに受け付けられませんでした"
        case "notImplemented":
            return "AIDE側にメモの受け口がまだありません（guchi-apps/aide#354）。下のメモをコピーして、Zaimアプリで貼り付けてください"
        case "rejected":
            return "Zaimの明細を書き換えられませんでした（金額・日付が一致しないか、明細が見つかりません）"
        case "conflict":
            return "前回の書き込み結果が確定していません。Zaimを確認してください"
        case "unreachable":
            return "AIDEへ接続できませんでした"
    }
}

function toMessage(payload: unknown, fallback: string): string {
    const record = payload as Record<string, unknown> | null
    const error = record && typeof record.error === "string" ? record.error.trim() : ""
    return error || fallback
}

/**
 * 送る前に本文を整える。**純粋関数。**
 *
 * 改行はZaimのメモ欄（1行の入力）に入らないため空白へ寄せ、前後の空白を落とし、上限で切る。
 * 上限を超えたままAIDEへ渡すと `invalid` で弾かれるだけなので、ここで収める。
 */
export function normalizeZaimMemo(comment: string): string {
    return comment.replace(/\s+/g, " ").trim().slice(0, ZAIM_MEMO_MAX_LENGTH)
}

/**
 * AIDEへ送るJSONを組み立てる。**純粋関数。**
 *
 * `lib/zaim-web-genre.ts` の `buildZaimWebGenreBody` と同じく、受け口の必須項目を落としたことに
 * 後から気づけるよう切り出している（Issue #335の再発防止）。
 */
export function buildZaimWebMemoBody(input: ZaimWebMemoInput): Record<string, unknown> {
    return {
        requestId: input.requestId,
        moneyId: input.moneyId,
        date: input.date,
        amount: input.amount,
        comment: input.comment,
    }
}

/**
 * 応答を結果へ畳む。**純粋関数。**
 *
 * `ok: true` 以外は成功として扱わない。応答の形が変わったまま「書き込めた」と記録すると、
 * 書き換わっていないメモを書けたものとして人が受け取る。
 */
export function parseZaimWebMemoResponse(payload: unknown): ZaimWebMemoResult {
    const record = payload as Record<string, unknown> | null
    if (!record || typeof record !== "object" || record.ok !== true) {
        throw new ZaimWebMemoError("unreachable", "AIDEの応答を解釈できませんでした")
    }

    const rawMoneyId = record.moneyId
    if (typeof rawMoneyId !== "number" || !Number.isFinite(rawMoneyId) || rawMoneyId <= 0) {
        throw new ZaimWebMemoError("unreachable", "AIDEの応答を解釈できませんでした")
    }

    return { moneyId: rawMoneyId, duplicated: record.duplicated === true }
}

/**
 * HTTPステータスを失敗の理由へ移す（aide#273の割り当てに合わせる）。
 *
 * **404は `unreachable` に丸めない。** 受け口自体が無い状態（AIDE側が未実装）を一時障害と
 * 区別できないと、何度押しても直らないボタンになる（`lib/zaim-web-genre.ts` と同じ理由）。
 */
function reasonForStatus(status: number): ZaimWebMemoErrorReason {
    if (status === 400) return "invalid"
    if (status === 401) return "unauthorized"
    if (status === 404) return "notImplemented"
    if (status === 409) return "conflict"
    if (status === 422) return "rejected"
    if (status === 503) return "unavailable"
    return "unreachable"
}

/** Web版の編集画面で、既存明細のメモだけを書き換える。 */
export async function updateZaimWebMemo(input: ZaimWebMemoInput): Promise<ZaimWebMemoResult> {
    const config = getZaimWebMemoConfig()
    if (!config) {
        throw new ZaimWebMemoError("notConfigured", describeZaimWebMemoError("notConfigured"))
    }

    let response: Response
    try {
        response = await fetch(config.baseUrl + ZAIM_WEB_MEMO_PATH, {
            method: "POST",
            headers: {
                Authorization: "Bearer " + config.secret,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(buildZaimWebMemoBody(input)),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            cache: "no-store",
        })
    } catch {
        throw new ZaimWebMemoError(
            "unreachable",
            describeZaimWebMemoError("unreachable") + ": " + config.baseUrl
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
        // 404 は受け口そのものが無い状態で、応答の本文（"not found" など）を出しても人は動けない。
        // 「コピーしてZaimアプリへ貼る」という次の手を伝えたいので、こちらの文言を通す。
        const message =
            reason === "notImplemented"
                ? describeZaimWebMemoError(reason)
                : toMessage(payload, describeZaimWebMemoError(reason))
        throw new ZaimWebMemoError(reason, message)
    }

    return parseZaimWebMemoResponse(payload)
}
