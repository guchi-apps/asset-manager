/**
 * Signaly（Webhook通知）への投稿。
 *
 * `next/headers` に依存しないため、Next.jsのリクエスト外（PM2のcronから動くスクリプト等）
 * からも読み込める。リクエスト情報を添えるログイン・新規登録通知は `lib/signaly.ts` にある。
 */

/**
 * Signalyの通知に添える送信元。共通チャンネルへ集約された通知（ログイン通知など）は、
 * チャンネルでは送信元を見分けられないため `notifications.source` で判別する。
 *
 * 値はこのリポジトリのCI・デプロイ通知と同じ `Asset Manager` にする。Signalyは
 * embedの `App` フィールド（`.github/scripts/signaly-notify.sh` が `NOTIFY_APP` から作る）を
 * `Repository` より優先して送信元にするため、リポジトリ名にすると通知一覧の送信元が
 * `Asset Manager` と `asset-manager` の2つに割れる（guchi-apps/signaly#204）。
 */
export const SIGNALY_SOURCE = "Asset Manager"

/**
 * 通知に載せる日時。`2026-08-25 14:03:22` を返す。
 *
 * 共通フォーマット（guchi-apps/signaly の `docs/webhook.md`）が `YYYY-MM-DD HH:MM:SS JST`
 * を求めているため、sv-SEロケールを使う。ja-JPは `month: "2-digit"` を渡せばゼロ埋め自体は
 * されるが、区切りが `2026/08/25` とスラッシュになり、共通フォーマットのハイフンにならない
 * （signaly の `docs/webhook.md` のコメントは「ゼロ埋めされない」と書いているが、実際に
 * ずれるのは区切り文字）。
 */
export function formatJstTimestamp(): string {
    return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).format(new Date())
}

export function buildSignalyPayload(content: string, options?: { source?: string }) {
    // sourceを指定しない通知（アプリ固有チャンネル宛）は従来どおりcontentだけを送る。
    return options?.source ? { source: options.source, content } : { content }
}

export async function postSignalyWebhook(
    webhookUrl: string | undefined,
    content: string,
    options?: { source?: string }
) {
    if (!webhookUrl) {
        console.warn("Signaly webhook URL not set; skipping notification")
        return
    }

    try {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildSignalyPayload(content, options)),
        })

        if (!response.ok) {
            console.warn(`Signaly webhook failed: ${response.status} ${response.statusText}`)
        }
    } catch (error) {
        console.warn("Failed to send Signaly notification:", error)
    }
}
