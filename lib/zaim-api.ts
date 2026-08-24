/**
 * Zaim API クライアント（Issue #153）。
 *
 * 既存の評価額取得（`lib/zaim-scraper.ts`）はPlaywrightで残高画面を巡回しているが、
 * 支出の登録はスクレイピングでは登録IDを受け取れず、重複登録の判定も置き換え候補の
 * 照合もできない。そのため支出の登録・参照だけ公式APIを使う。
 *
 * 認証情報は環境変数から読む。ユーザーごとの連携は #147 の範囲。
 */

import { buildAuthorizationHeader } from "@/lib/zaim-oauth"

export const ZAIM_API_BASE = "https://api.zaim.net/v2"
export const ZAIM_REQUEST_TOKEN_URL = "https://api.zaim.net/v2/auth/request"
export const ZAIM_AUTHORIZE_URL = "https://auth.zaim.net/users/auth"
export const ZAIM_ACCESS_TOKEN_URL = "https://api.zaim.net/v2/auth/access"

const REQUEST_TIMEOUT_MS = 30_000

export interface ZaimApiCredentials {
    consumerKey: string
    consumerSecret: string
    accessToken: string
    accessTokenSecret: string
}

export class ZaimApiError extends Error {
    constructor(
        message: string,
        readonly status?: number,
        readonly body?: string
    ) {
        super(message)
        this.name = "ZaimApiError"
    }
}

/** 未設定なら null を返す。呼び出し側は「連携していない」として扱う。 */
export function getZaimApiCredentials(): ZaimApiCredentials | null {
    const consumerKey = process.env.ZAIM_CONSUMER_KEY
    const consumerSecret = process.env.ZAIM_CONSUMER_SECRET
    const accessToken = process.env.ZAIM_ACCESS_TOKEN
    const accessTokenSecret = process.env.ZAIM_ACCESS_TOKEN_SECRET

    if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) return null
    return { consumerKey, consumerSecret, accessToken, accessTokenSecret }
}

/** 「反映待ち」口座のZaim account_id。未設定なら null。 */
export function getZaimPendingAccountId(): number | null {
    const raw = process.env.ZAIM_PENDING_ACCOUNT_ID
    if (!raw) return null
    const value = Number(raw)
    return Number.isInteger(value) && value > 0 ? value : null
}

export type ZaimRequestParams = Record<string, string | number | undefined | null>

function toSearchParams(params: ZaimRequestParams): URLSearchParams {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "") continue
        search.set(key, String(value))
    }
    return search
}

/**
 * Zaim APIを1回呼ぶ。
 *
 * OAuth 1.0a の署名はクエリ・フォームの両方のパラメータを含めて計算する必要があるため、
 * GETはクエリ、POST/PUTはフォームに載せたうえで、同じ内容を署名にも渡している。
 */
export async function zaimApiRequest<T>(
    credentials: ZaimApiCredentials,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    params: ZaimRequestParams = {}
): Promise<T> {
    const url = path.startsWith("http") ? path : ZAIM_API_BASE + path
    const search = toSearchParams(params)
    const signedParams: ZaimRequestParams = Object.fromEntries(search.entries())

    const authorization = buildAuthorizationHeader({
        method,
        url,
        params: signedParams,
        consumerKey: credentials.consumerKey,
        consumerSecret: credentials.consumerSecret,
        token: credentials.accessToken,
        tokenSecret: credentials.accessTokenSecret,
    })

    const isBodyMethod = method === "POST" || method === "PUT"
    const requestUrl = isBodyMethod || search.size === 0 ? url : url + "?" + search.toString()

    let response: Response
    try {
        response = await fetch(requestUrl, {
            method,
            headers: {
                Authorization: authorization,
                ...(isBodyMethod
                    ? { "Content-Type": "application/x-www-form-urlencoded" }
                    : {}),
            },
            body: isBodyMethod ? search.toString() : undefined,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new ZaimApiError("Zaim APIへの接続に失敗しました: " + message)
    }

    const text = await response.text()

    if (!response.ok) {
        // 認可が切れているのか、パラメータが誤っているのかで対処が変わるため分けて返す。
        if (response.status === 401) {
            throw new ZaimApiError(
                "Zaim APIの認可が無効です。アクセストークンを取り直してください。",
                response.status,
                text
            )
        }
        throw new ZaimApiError(
            "Zaim APIがエラーを返しました (HTTP " + response.status + ")",
            response.status,
            text
        )
    }

    try {
        return JSON.parse(text) as T
    } catch {
        throw new ZaimApiError("Zaim APIの応答を解釈できませんでした", response.status, text)
    }
}

export interface ZaimCategoryResponseItem {
    id: number
    name: string
    mode: string
    sort: number
    active: number
}

export interface ZaimGenreResponseItem {
    id: number
    category_id: number
    name: string
    sort: number
    active: number
}

export interface ZaimAccountResponseItem {
    id: number
    name: string
    sort: number
    active: number
}

export interface ZaimMoneyResponseItem {
    id: number
    mode: string
    date: string
    category_id: number
    genre_id: number
    from_account_id: number
    to_account_id: number
    amount: number
    comment: string
    active: number
    name: string
    place: string
}

export async function fetchZaimCategories(
    credentials: ZaimApiCredentials
): Promise<ZaimCategoryResponseItem[]> {
    const result = await zaimApiRequest<{ categories: ZaimCategoryResponseItem[] }>(
        credentials,
        "GET",
        "/home/category",
        { mapping: 1 }
    )
    return result.categories ?? []
}

export async function fetchZaimGenres(
    credentials: ZaimApiCredentials
): Promise<ZaimGenreResponseItem[]> {
    const result = await zaimApiRequest<{ genres: ZaimGenreResponseItem[] }>(
        credentials,
        "GET",
        "/home/genre",
        { mapping: 1 }
    )
    return result.genres ?? []
}

export async function fetchZaimAccounts(
    credentials: ZaimApiCredentials
): Promise<ZaimAccountResponseItem[]> {
    const result = await zaimApiRequest<{ accounts: ZaimAccountResponseItem[] }>(
        credentials,
        "GET",
        "/home/account",
        { mapping: 1 }
    )
    return result.accounts ?? []
}

export interface ZaimPaymentInput {
    /** YYYY-MM-DD（JST）。 */
    date: string
    categoryId: number
    genreId: number
    amount: number
    /** 支払元口座。「反映待ち」口座のid。 */
    fromAccountId?: number | null
    /** 商品名。Zaimの「品目」欄。 */
    name?: string | null
    /** 店舗名。Zaimの「お店」欄。 */
    place?: string | null
    comment?: string | null
}

/** 支出を1件登録し、Zaim側のidを返す。 */
export async function createZaimPayment(
    credentials: ZaimApiCredentials,
    input: ZaimPaymentInput
): Promise<{ id: number }> {
    const result = await zaimApiRequest<{ money?: { id?: number } }>(
        credentials,
        "POST",
        "/home/money/payment",
        {
            mapping: 1,
            category_id: input.categoryId,
            genre_id: input.genreId,
            amount: Math.round(input.amount),
            date: input.date,
            from_account_id: input.fromAccountId ?? undefined,
            name: input.name ?? undefined,
            place: input.place ?? undefined,
            comment: input.comment ?? undefined,
        }
    )

    const id = result.money?.id
    if (!id) {
        throw new ZaimApiError("Zaimが登録した支出のidを返しませんでした")
    }
    return { id }
}

/** 登録に失敗した途中経過を巻き戻すために使う。 */
export async function deleteZaimPayment(
    credentials: ZaimApiCredentials,
    moneyId: number
): Promise<void> {
    await zaimApiRequest(credentials, "DELETE", "/home/money/payment/" + moneyId, {
        mapping: 1,
    })
}

export interface ZaimMoneyQuery {
    /** YYYY-MM-DD */
    startDate: string
    /** YYYY-MM-DD */
    endDate: string
    mode?: "payment" | "income" | "transfer"
    limit?: number
}

export async function fetchZaimMoney(
    credentials: ZaimApiCredentials,
    query: ZaimMoneyQuery
): Promise<ZaimMoneyResponseItem[]> {
    const result = await zaimApiRequest<{ money: ZaimMoneyResponseItem[] }>(
        credentials,
        "GET",
        "/home/money",
        {
            mapping: 1,
            start_date: query.startDate,
            end_date: query.endDate,
            mode: query.mode,
            limit: query.limit ?? 100,
            order: "date",
        }
    )
    return result.money ?? []
}
