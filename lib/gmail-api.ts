/**
 * Gmail APIクライアント（Issue #271）。
 *
 * `googleapis` を入れずに `fetch` だけで書いているのは、叩くのが
 * 「トークン更新 / メッセージ検索 / メッセージ取得」の3本だけで、依存を増やす価値が無いため
 * （`lib/receipt-analysis.ts` で Anthropic の SDK を入れなかったのと同じ判断）。
 *
 * 認可はリフレッシュトークン方式。ブラウザでの同意は `scripts/gmail-oauth.ts` で一度だけ行い、
 * 得たリフレッシュトークンを `.env` に置く。スコープは `gmail.readonly` だけで、
 * **メールの既読・ラベル・削除には触れない。**
 */

import type { GmailMessagePayload } from "@/lib/gmail-query"

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
export const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"

/** 読み取り専用。書き込みスコープは要求しない。 */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"

const REQUEST_TIMEOUT_MS = 30_000

export class GmailApiError extends Error {
    constructor(
        message: string,
        readonly status?: number
    ) {
        super(message)
        this.name = "GmailApiError"
    }
}

export interface GmailCredentials {
    clientId: string
    clientSecret: string
    refreshToken: string
}

/** 未設定なら null を返す。呼び出し側は「Gmailを連携していない」として扱う。 */
export function getGmailCredentials(): GmailCredentials | null {
    const clientId = process.env.GMAIL_CLIENT_ID
    const clientSecret = process.env.GMAIL_CLIENT_SECRET
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN

    if (!clientId || !clientSecret || !refreshToken) return null
    return { clientId, clientSecret, refreshToken }
}

/**
 * 接続先のアカウントを画面に出すための表示名。実アドレスは伏せる。
 *
 * 秘密情報ではないが、画面共有やスクリーンショットへそのまま載るのを避ける。
 */
export function maskEmail(email: string | null | undefined): string | null {
    if (!email) return null
    const at = email.indexOf("@")
    if (at <= 0) return "***"
    return email.slice(0, 1) + "***" + email.slice(at)
}

interface TokenResponse {
    access_token?: string
    expires_in?: number
    error?: string
    error_description?: string
}

/**
 * リフレッシュトークンからアクセストークンを取り直す。
 *
 * アクセストークンは1時間で切れるうえ、Next.jsのサーバーはプロセスをまたいで動く。
 * 保存して使い回すより、取り込みのたびに1回取り直すほうが単純で壊れにくい。
 */
export async function fetchAccessToken(credentials: GmailCredentials): Promise<string> {
    let response: Response
    try {
        response = await fetch(GOOGLE_TOKEN_URL, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: credentials.clientId,
                client_secret: credentials.clientSecret,
                refresh_token: credentials.refreshToken,
                grant_type: "refresh_token",
            }).toString(),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new GmailApiError("Googleの認証サーバーへ接続できませんでした: " + message)
    }

    const json = (await response.json().catch(() => ({}))) as TokenResponse

    if (!response.ok || !json.access_token) {
        // invalid_grant はリフレッシュトークンが失効している合図で、取り直すしか直せない。
        if (json.error === "invalid_grant") {
            throw new GmailApiError(
                "Gmailの連携が失効しています。scripts/gmail-oauth.ts でトークンを取り直してください。",
                response.status
            )
        }
        throw new GmailApiError(
            "Gmailのアクセストークンを取得できませんでした" +
                (json.error ? "（" + json.error + "）" : ""),
            response.status
        )
    }

    return json.access_token
}

async function gmailRequest<T>(accessToken: string, path: string, params: URLSearchParams): Promise<T> {
    const url = GMAIL_API_BASE + path + (params.size > 0 ? "?" + params.toString() : "")

    let response: Response
    try {
        response = await fetch(url, {
            headers: { Authorization: "Bearer " + accessToken },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new GmailApiError("Gmailへの接続に失敗しました: " + message)
    }

    if (!response.ok) {
        const text = await response.text().catch(() => "")
        console.error("Gmail API failed:", response.status, text.slice(0, 500))
        if (response.status === 401 || response.status === 403) {
            throw new GmailApiError(
                "Gmailの認可が無効です。スコープを含めてトークンを取り直してください。",
                response.status
            )
        }
        if (response.status === 429) {
            throw new GmailApiError(
                "Gmailの利用制限に達しました。時間をおいて再実行してください。",
                response.status
            )
        }
        throw new GmailApiError("GmailがエラーHTTP " + response.status + " を返しました", response.status)
    }

    return (await response.json()) as T
}

export interface GmailMessageRef {
    id: string
    threadId: string
}

interface ListMessagesResponse {
    messages?: GmailMessageRef[]
    nextPageToken?: string
}

/**
 * 検索式に合うメッセージのidを集める。
 *
 * 1ページ100件で、`maxMessages` に達するまで辿る。上限を置くのは、条件を広く書いたときに
 * 受信箱を丸ごと取りに行って時間もAPIの割り当ても使い切るのを防ぐため。
 */
export async function listMessageIds(
    accessToken: string,
    query: string,
    maxMessages: number
): Promise<GmailMessageRef[]> {
    const collected: GmailMessageRef[] = []
    let pageToken: string | undefined

    while (collected.length < maxMessages) {
        const params = new URLSearchParams({
            q: query,
            maxResults: String(Math.min(100, maxMessages - collected.length)),
        })
        if (pageToken) params.set("pageToken", pageToken)

        const page = await gmailRequest<ListMessagesResponse>(accessToken, "/messages", params)
        collected.push(...(page.messages ?? []))

        if (!page.nextPageToken || (page.messages ?? []).length === 0) break
        pageToken = page.nextPageToken
    }

    return collected.slice(0, maxMessages)
}

export interface GmailMessage {
    id: string
    threadId: string
    /** 受信日時（ミリ秒）。文字列で返るので数値へ直す。 */
    internalDate: number | null
    snippet: string
    payload?: GmailMessagePayload
}

interface RawGmailMessage {
    id: string
    threadId: string
    internalDate?: string
    snippet?: string
    payload?: GmailMessagePayload
}

export async function fetchMessage(accessToken: string, messageId: string): Promise<GmailMessage> {
    const raw = await gmailRequest<RawGmailMessage>(
        accessToken,
        "/messages/" + encodeURIComponent(messageId),
        new URLSearchParams({ format: "full" })
    )

    const internalDate = raw.internalDate ? Number(raw.internalDate) : NaN

    return {
        id: raw.id,
        threadId: raw.threadId,
        internalDate: Number.isFinite(internalDate) ? internalDate : null,
        snippet: raw.snippet ?? "",
        payload: raw.payload,
    }
}

interface ProfileResponse {
    emailAddress?: string
}

/** 接続先のアカウントを確かめる。設定画面の「接続済み」表示に使う。 */
export async function fetchProfileEmail(accessToken: string): Promise<string | null> {
    const profile = await gmailRequest<ProfileResponse>(accessToken, "/profile", new URLSearchParams())
    return profile.emailAddress ?? null
}
