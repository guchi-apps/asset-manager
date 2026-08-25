/**
 * Signaly（Webhook通知）への投稿。
 *
 * `next/headers` に依存しないため、Next.jsのリクエスト外（PM2のcronから動くスクリプト等）
 * からも読み込める。リクエスト情報を添えるログイン・新規登録通知は `lib/signaly.ts` にある。
 */

/**
 * Signalyの通知に添える送信元。共通チャンネルへ集約された通知（ログイン通知など）は、
 * チャンネルでは送信元を見分けられないため `notifications.source` で判別する。
 * CI・デプロイ通知がembedの `Repository`（`guchi-apps/<repo>`）末尾から作る値と
 * 揃えるため、リポジトリ名をそのまま使う（guchi-apps/issue-deck#2287）。
 */
export const SIGNALY_SOURCE = "asset-manager"

export function formatJstTimestamp(): string {
    return new Date().toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    })
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
