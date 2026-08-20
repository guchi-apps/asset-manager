/**
 * Signaly（Webhook通知）への投稿。
 *
 * `next/headers` に依存しないため、Next.jsのリクエスト外（PM2のcronから動くスクリプト等）
 * からも読み込める。リクエスト情報を添えるログイン・新規登録通知は `lib/signaly.ts` にある。
 */

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

export async function postSignalyWebhook(webhookUrl: string | undefined, content: string) {
    if (!webhookUrl) {
        console.warn("Signaly webhook URL not set; skipping notification")
        return
    }

    try {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
        })

        if (!response.ok) {
            console.warn(`Signaly webhook failed: ${response.status} ${response.statusText}`)
        }
    } catch (error) {
        console.warn("Failed to send Signaly notification:", error)
    }
}
