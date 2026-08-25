import { headers } from "next/headers"

import { SIGNALY_SOURCE, formatJstTimestamp } from "@/lib/signaly-webhook"

/**
 * Signaly へのログイン・新規登録通知。
 *
 * **フォーマットの正は signaly の `docs/webhook.md`「ログイン通知の共通フォーマット」。**
 * ログイン通知は全アプリで1本のチャンネルへ集約しているため、ここだけ独自の形にすると、
 * 並べたときに同じ種類の通知に見えない。**このファイルで変えてよいのは `APP_NAME` と
 * Webhook URL の環境変数名だけ**で、残りは全アプリ共通のテンプレート
 * （guchi-apps/signaly#204）。
 *
 * **フィールド名 `接続元IP` を変えないこと。** Signaly はこの名前を手がかりに
 * 「見覚えのない接続元からのログインか」を判定し、初めての接続元なら通知を黄色にする。
 * 名前を変えるとこの警告が黙って効かなくなる。
 *
 * 通知の中身は `content` のベタ書きではなく `fields` で送る。ベタ書きだとカードの高さが
 * 倍以上になり、他アプリの通知と並べたときに揃わない。
 */
const APP_NAME = SIGNALY_SOURCE // = "Asset Manager"。CI・デプロイ通知の送信元と同じ値にする

const COLOR_LOGIN = "#57f287"
const COLOR_SIGNUP = "#fbbf24"
const MAX_VALUE_LEN = 500

type SignalyField = { name: string; value: string; inline: boolean }

async function buildFields(options: {
    email?: string | null
    name?: string | null
    provider?: string | null
}): Promise<SignalyField[]> {
    const headersList = await headers()
    const ip =
        headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        headersList.get("x-real-ip")
    const userAgent = headersList.get("user-agent")

    // 値が取れない項目は「不明」と書かず、フィールドごと落とす。「不明」を並べると
    // どのアプリでも行数は揃うが、実際に取れている情報が読み取れなくなる。
    const fields: SignalyField[] = []
    const push = (name: string, value: string | null | undefined, inline: boolean) => {
        if (value) fields.push({ name, value: value.slice(0, MAX_VALUE_LEN), inline })
    }

    push("ユーザー", options.name, true)
    push("メール", options.email, true)
    // プロバイダは `google` のように受け取った値をそのまま出す。表示用に言い換えると、
    // 同じチャンネルへ集まる他アプリの通知と値が食い違う。
    push("プロバイダ", options.provider, true)
    push("接続元IP", ip, true)
    fields.push({ name: "日時", value: `${formatJstTimestamp()} JST`, inline: false })
    push("User-Agent", userAgent, false)

    return fields
}

async function post(
    webhookUrl: string | undefined,
    body: { title: string; color: string; fields: SignalyField[] },
): Promise<void> {
    if (!webhookUrl) {
        console.warn("[signaly] Webhook URL が未設定のため、通知を送りません")
        return
    }

    try {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                // 集約先のチャンネルではチャンネルで送信元を見分けられないため、必ず載せる
                source: APP_NAME,
                level: "info",
                ...body,
            }),
        })

        if (!response.ok) {
            console.error(
                `[signaly] 通知に失敗しました: ${response.status} ${response.statusText}`,
            )
        }
    } catch (error) {
        console.error("[signaly] 通知の送信に失敗しました:", error)
    }
}

export async function sendLoginNotification(options: {
    email?: string | null
    name?: string | null
    provider?: string | null
}): Promise<void> {
    await post(process.env.SIGNALY_LOGIN_WEBHOOK_URL, {
        title: `🔐 ${APP_NAME} ログイン`,
        color: COLOR_LOGIN,
        fields: await buildFields(options),
    })
}

export async function sendRegisterNotification(options: {
    email?: string | null
    name?: string | null
    provider?: string | null
}): Promise<void> {
    await post(process.env.SIGNALY_REGISTER_WEBHOOK_URL, {
        title: `🎉 ${APP_NAME} 新規ユーザー登録`,
        color: COLOR_SIGNUP,
        fields: await buildFields(options),
    })
}
