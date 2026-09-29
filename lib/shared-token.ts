/**
 * issue-deck の共有トークン API（guchi-apps/issue-deck の `docs/shared-token-api.md`）から、
 * 他アプリ用に登録したトークンを実行時に読む（Issue #603）。1Password から値を複製せず、
 * issue-deck を唯一の正にする「方式A」。
 *
 * `SHARED_TOKEN_API_SECRET`・`ISSUE_DECK_URL` の両方が揃っていない環境（ローカル・移行前）では
 * この経路を使わず、呼び出し元が環境変数へフォールバックする。
 *
 * **トークンの値と Bearer の値は、ログ・例外メッセージに出さない。**
 */

const CACHE_MS = 10 * 60 * 1000
const TIMEOUT_MS = 5_000

/** issue-deck の設定画面に「利用元」として表示される名前。 */
export const SHARED_TOKEN_CONSUMER = "asset-manager"

export interface SharedTokenCacheEntry {
    value: string
    fetchedAtMs: number
}

export interface SharedTokenResult {
    /**
     * 優先順位: 新しいキャッシュ → issue-deck から取得 → 失敗時は古くても直前のキャッシュ
     * → 無ければ null（呼び出し側で環境変数へフォールバックする）。
     */
    value: string | null
    /** 呼び出し元が次回へ引き継ぐキャッシュ。取得に失敗しても直前の値を保つ。 */
    cache: SharedTokenCacheEntry | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

/** 副作用（キャッシュの保持）を呼び出し元へ出し、この関数自体はテストしやすい形にする。 */
export async function resolveSharedToken(
    name: string,
    previous: SharedTokenCacheEntry | null,
    options: { now?: number } = {}
): Promise<SharedTokenResult> {
    const now = options.now ?? Date.now()

    if (previous && now - previous.fetchedAtMs < CACHE_MS) {
        return { value: previous.value, cache: previous }
    }

    const baseUrl = process.env.ISSUE_DECK_URL?.trim()
    const secret = process.env.SHARED_TOKEN_API_SECRET?.trim()

    if (!baseUrl || !secret) {
        return { value: previous?.value ?? null, cache: previous }
    }

    try {
        const url = `${baseUrl.replace(/\/+$/, "")}/api/shared-tokens?name=${encodeURIComponent(name)}`
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${secret}`,
                "X-Shared-Token-Consumer": SHARED_TOKEN_CONSUMER,
                Accept: "application/json",
            },
            signal: AbortSignal.timeout(TIMEOUT_MS),
            cache: "no-store",
        })

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
        }

        const payload: unknown = await response.json()
        if (!isRecord(payload) || typeof payload.value !== "string" || payload.value.trim() === "") {
            throw new Error("unexpected payload")
        }

        const value = payload.value.trim()
        return { value, cache: { value, fetchedAtMs: now } }
    } catch (error) {
        // error.message には値を含めない（HTTPステータスか固定文言のみ）。
        console.error(
            `共有トークンの取得に失敗しました(${name}):`,
            error instanceof Error ? error.message : "unknown error"
        )
        return { value: previous?.value ?? null, cache: previous }
    }
}

const caches = new Map<string, SharedTokenCacheEntry>()

/** キャッシュ付きで共有トークンを取得する。取得できなければ null。 */
export async function getSharedToken(name: string): Promise<string | null> {
    const result = await resolveSharedToken(name, caches.get(name) ?? null)
    if (result.cache) caches.set(name, result.cache)
    return result.value
}

/** 共有トークンを優先し、取れなければ環境変数の値を返す。どちらも無ければ undefined。 */
export async function getSharedTokenOrEnv(name: string, envValue: string | undefined): Promise<string | undefined> {
    return (await getSharedToken(name)) ?? (envValue || undefined)
}
