/**
 * Discordへの異常通知（共通のアラート用Webhook）。
 *
 * 送るのは「人の対応が要る異常」だけにする。成功・通常ログイン・復旧は送らない。
 * `next/headers` に依存しないため、PM2のcronから動くスクリプトからも読み込める。
 *
 * Webhook URLは全リポジトリ共通の1本（1Password `apps/Notify/alert-webhook-url`）を
 * `DISCORD_ALERT_WEBHOOK_URL` で受け取る。URLの実値をログへ出さない。
 */

/** Discordのembed色（赤）。 */
const COLOR_ALERT = 0xed4245

const SOURCE = "Asset Manager"
const MAX_TITLE_LEN = 200
const MAX_DESCRIPTION_LEN = 1800
const MAX_ATTEMPTS = 3
const REQUEST_TIMEOUT_MS = 10_000
const DEFAULT_RETRY_WAIT_MS = 1_000
const MAX_RETRY_WAIT_MS = 5_000

export function buildDiscordAlertPayload(title: string, lines: string[]) {
    return {
        embeds: [
            {
                title: `${title}`.slice(0, MAX_TITLE_LEN),
                description: lines.join("\n").slice(0, MAX_DESCRIPTION_LEN),
                color: COLOR_ALERT,
                footer: { text: SOURCE },
                timestamp: new Date().toISOString(),
            },
        ],
        // メンション展開を許さない（本文に `@everyone` が紛れても通知が飛ばないように）。
        allowed_mentions: { parse: [] as string[] },
    }
}

/** 再試行してよい応答か。レート制限(429)と5xxだけ。ほかの4xxはURLやペイロードの誤りで、繰り返しても通らない。 */
export function isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500
}

function retryWaitMs(response: Response): number {
    const retryAfter = Number(response.headers.get("retry-after"))
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
        return Math.min(retryAfter * 1000, MAX_RETRY_WAIT_MS)
    }
    return DEFAULT_RETRY_WAIT_MS
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 異常をDiscordへ1件投稿する。配信に失敗しても呼び出し元の処理は止めない（例外を投げない）。
 *
 * - 通信エラー・429・5xxは最大 `MAX_ATTEMPTS` 回まで再試行する
 * - 未設定・配信失敗はログに残す。戻り値で配信できたかを返す
 * - 失敗時のログにはURLを含めない
 */
export async function postDiscordAlert(title: string, lines: string[]): Promise<boolean> {
    const webhookUrl = process.env.DISCORD_ALERT_WEBHOOK_URL
    if (!webhookUrl) {
        console.warn("[discord-alert] DISCORD_ALERT_WEBHOOK_URL が未設定のため、通知を送りません")
        return false
    }

    const body = JSON.stringify(buildDiscordAlertPayload(title, lines))

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let wait = DEFAULT_RETRY_WAIT_MS
        try {
            const response = await fetch(webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            })
            if (response.ok) return true

            console.error(`[discord-alert] 通知に失敗しました: ${response.status} (${attempt}/${MAX_ATTEMPTS})`)
            if (!isRetryableStatus(response.status)) return false
            wait = retryWaitMs(response)
        } catch (error) {
            // エラーオブジェクトにURLが含まれうるため、名前だけを出す。
            const name = error instanceof Error ? error.name : "UnknownError"
            console.error(`[discord-alert] 通知の送信に失敗しました: ${name} (${attempt}/${MAX_ATTEMPTS})`)
        }
        if (attempt < MAX_ATTEMPTS) await sleep(wait)
    }
    return false
}
