/**
 * Zaim Web版（my.zaim.net）の入力画面への支出登録を、AIDE経由で1件行う（Issue #302）。
 *
 * **Zaim APIの支出登録は「置き換え」の候補にならない。** 品目・出金元・日付・金額をまったく
 * 同じにしても、APIで作った明細はアプリの置き換え候補に並ばず、Web版の入力画面で作った明細は
 * 並ぶ（#300 の実測。`docs/receipt-import.md`「置き換えの成立条件と検証」）。
 * 分かれ目は条件の中身ではなく作成経路にあるため、登録経路そのものを差し替える必要がある。
 *
 * Web版の入力画面を操作できるのはAIDE（`guchi-apps/aide`）だけで、このリポジトリには
 * PlaywrightもZaimのログイン状態も無い（`docs/zaim-auto-sync.md`「責務の分担」）。
 * ここが持つのはHTTPの呼び出しと失敗の分類だけにして、画面操作の知識は持ち込まない。
 *
 * **失敗したらZaim APIでの登録へ落とさない。** 落とすと「登録されているのに置き換えられない
 * 明細」が静かに増える。呼び出し元は失敗を失敗のまま受け取り、人が確認する状態で止める。
 */

import { DEFAULT_AIDE_BASE_URL } from "./zaim-aide"

/** AIDE側の受け口（aide#214）。 */
export const ZAIM_WEB_PAYMENT_PATH = "/api/zaim/payment/web"

/**
 * 画面操作の待ち時間。
 *
 * 読み取りAPI（`lib/zaim-aide.ts`）はキャッシュを読むだけなので10秒で切っているが、こちらは
 * ヘッドレスブラウザでログイン・入力・保存まで進む。数十秒かかるのが普通なので、
 * 詰まりの検知にしか使えない長さにしておく。
 */
const REQUEST_TIMEOUT_MS = 180_000

export type ZaimWebPaymentErrorReason =
    /** asset-manager 側に AIDE_ZAIM_WRITE_SECRET が無い */
    | "notConfigured"
    /** AIDE側にシークレット・Zaimのログイン状態が無く、受け口が開いていない（503） */
    | "unavailable"
    /** シークレットが違う（401） */
    | "unauthorized"
    /** 送った内容が受け付けられない（400） */
    | "invalid"
    /** Zaim側の事情で登録できなかった（422）。画面要素の不一致もここに入る */
    | "rejected"
    /** 前回の結果が確定していない（409）。**送り直すと二重登録になりうる** */
    | "conflict"
    /** 接続できない・応答が壊れている */
    | "unreachable"

export class ZaimWebPaymentError extends Error {
    constructor(
        readonly reason: ZaimWebPaymentErrorReason,
        message: string
    ) {
        super(message)
        this.name = "ZaimWebPaymentError"
    }

    /**
     * 同じ内容をそのまま送り直してよいか。
     *
     * `conflict` は前回の登録が成立したかどうかが分からない状態なので、機械が送り直しては
     * いけない（人がZaimを見て決める）。`rejected` はZaimの仕様変更を疑う状態で、
     * 送り直しても同じところで止まる。
     */
    get retryable(): boolean {
        return this.reason === "unreachable"
    }
}

export interface ZaimWebPaymentConfig {
    baseUrl: string
    secret: string
}

/**
 * 未設定なら null。
 *
 * シークレットは読み取り用（`AIDE_READ_SECRET`）とは**別の値**にする。残高を読むだけの経路へ
 * Zaimへ書き込む権限まで渡さないため（AIDE側 `src/api/zaim.ts` と同じ考え方）。
 */
export function getZaimWebPaymentConfig(): ZaimWebPaymentConfig | null {
    const secret = process.env.AIDE_ZAIM_WRITE_SECRET
    if (!secret) return null
    // 末尾の「/」を落とす。付いたままだと `//api/zaim/payment/web` になる。
    const baseUrl = (process.env.AIDE_BASE_URL || DEFAULT_AIDE_BASE_URL).replace(/\/+$/, "")
    return { baseUrl, secret }
}

/** Web版登録が使えるか。画面のボタンの可否に使う。 */
export function isZaimWebPaymentConfigured(): boolean {
    return getZaimWebPaymentConfig() !== null
}

export interface ZaimWebPaymentInput {
    /** 二重登録を防ぐキー。同じ値の再送はZaimへ送られず、前回の結果が返る。 */
    requestId: string
    /** YYYY-MM-DD（JST）。 */
    date: string
    amount: number
    /** 品目。**置き換えの条件なので必ず入れる。** */
    name: string
    place: string | null
    categoryId: number
    genreId: number
    /** 出金元。**自動連携しているクレジットカードを指定する（置き換えの条件）。** */
    fromAccountId: number
    comment?: string | null
}

export interface ZaimWebPaymentResult {
    /**
     * Zaim側のレコードid。**画面から取れない場合は null。**
     * 呼び出し元は「登録済みだがidが分からない」状態として扱い、再送は `requestId` に頼る。
     */
    moneyId: number | null
    /** 同じ `requestId` で登録済みだったため、Zaimへは送っていない。 */
    duplicated: boolean
}

/** 失敗の理由を、画面にそのまま出せる日本語にする。 */
export function describeZaimWebPaymentError(reason: ZaimWebPaymentErrorReason): string {
    switch (reason) {
        case "notConfigured":
            return "AIDEへのZaim登録が設定されていません（AIDE_ZAIM_WRITE_SECRET）"
        case "unavailable":
            return "AIDE側のZaim登録が有効になっていません"
        case "unauthorized":
            return "AIDEの登録キーが受け付けられませんでした"
        case "invalid":
            return "登録内容がAIDEに受け付けられませんでした"
        case "rejected":
            return "ZaimのWeb版画面へ登録できませんでした（画面の作りが変わった可能性があります）"
        case "conflict":
            return "前回の登録結果が確定していません。Zaimを確認してください"
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
 * 応答を結果へ畳む。**純粋関数。**
 *
 * `ok: true` 以外は成功として扱わない。応答の形が変わったまま「登録できた」と記録すると、
 * 登録されていない明細が登録済みとして残る。
 */
export function parseZaimWebPaymentResponse(payload: unknown): ZaimWebPaymentResult {
    const record = payload as Record<string, unknown> | null
    if (!record || typeof record !== "object" || record.ok !== true) {
        throw new ZaimWebPaymentError("unreachable", "AIDEの応答を解釈できませんでした")
    }

    const rawMoneyId = record.moneyId
    const moneyId =
        typeof rawMoneyId === "number" && Number.isFinite(rawMoneyId) && rawMoneyId > 0
            ? rawMoneyId
            : null

    return { moneyId, duplicated: record.duplicated === true }
}

/** HTTPステータスを失敗の理由へ移す（AIDE側 `statusFor` の逆変換）。 */
function reasonForStatus(status: number): ZaimWebPaymentErrorReason {
    if (status === 400) return "invalid"
    if (status === 401) return "unauthorized"
    if (status === 409) return "conflict"
    if (status === 422) return "rejected"
    if (status === 503) return "unavailable"
    return "unreachable"
}

/** レシート1行に対応する冪等キー。行のidが変わらない限り、何度送っても1件しか登録されない。 */
export function buildReceiptItemRequestId(receiptItemId: number): string {
    return "asset-manager:receipt-item:" + receiptItemId
}

/**
 * Web版の入力画面へ支出を1件登録する。
 *
 * 応答が200でも `ok: true` でなければ失敗として扱う（`parseZaimWebPaymentResponse`）。
 */
export async function registerZaimWebPayment(
    input: ZaimWebPaymentInput
): Promise<ZaimWebPaymentResult> {
    const config = getZaimWebPaymentConfig()
    if (!config) {
        throw new ZaimWebPaymentError("notConfigured", describeZaimWebPaymentError("notConfigured"))
    }

    let response: Response
    try {
        response = await fetch(config.baseUrl + ZAIM_WEB_PAYMENT_PATH, {
            method: "POST",
            headers: {
                Authorization: "Bearer " + config.secret,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                requestId: input.requestId,
                date: input.date,
                amount: input.amount,
                name: input.name,
                place: input.place ?? undefined,
                categoryId: input.categoryId,
                genreId: input.genreId,
                fromAccountId: input.fromAccountId,
                comment: input.comment ?? undefined,
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            cache: "no-store",
        })
    } catch {
        throw new ZaimWebPaymentError(
            "unreachable",
            describeZaimWebPaymentError("unreachable") + ": " + config.baseUrl
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
        throw new ZaimWebPaymentError(
            reason,
            toMessage(payload, describeZaimWebPaymentError(reason))
        )
    }

    return parseZaimWebPaymentResponse(payload)
}
