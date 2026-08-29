import { createInterface } from "node:readline/promises"
import {
    fetchAccessToken,
    fetchProfileEmail,
    getGmailCredentials,
    GMAIL_SCOPE,
    GOOGLE_AUTH_URL,
    GOOGLE_TOKEN_URL,
} from "../lib/gmail-api"

/**
 * Gmail APIのリフレッシュトークンを取得する対話スクリプト（Issue #271）。
 *
 * OAuth 2.0 の同意はブラウザでしか完了できず、このサーバーにはGUIが無い。
 * そのため `scripts/zaim-oauth.ts` と同じく「URLを表示 → 手元のブラウザで許可 → 戻り先URLを貼る」形にしている。
 * 取得した値は表示するだけで、ファイルにもDBにも書かない（`.env` へ人が貼る）。
 *
 *   npx -y tsx scripts/gmail-oauth.ts          # リフレッシュトークンを取得する
 *   npx -y tsx scripts/gmail-oauth.ts --check  # 設定済みの値で接続を確かめる
 *
 * 事前にGoogle Cloudで「OAuth クライアント ID」を作り、種類は**デスクトップアプリ**を選ぶ。
 * デスクトップアプリは戻り先URLの登録が要らず、GUIの無いサーバーでも手順を短くできる。
 */

/**
 * 戻り先。デスクトップアプリのクライアントはローカルホストを常に受け付ける。
 * このポートで待ち受けるサーバーは無くてよい（ページが表示できなくても、URLさえ読めれば足りる）。
 */
const REDIRECT_URI = process.env.GMAIL_OAUTH_REDIRECT_URI || "http://localhost:9271/gmail/callback"

async function check() {
    const credentials = getGmailCredentials()
    if (!credentials) {
        console.error(
            "❌ GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN を設定してください"
        )
        process.exitCode = 1
        return
    }

    const accessToken = await fetchAccessToken(credentials)
    const email = await fetchProfileEmail(accessToken)
    console.log("✅ 接続できました: " + (email ?? "(アドレスを取得できませんでした)"))
}

async function obtainRefreshToken() {
    const clientId = process.env.GMAIL_CLIENT_ID
    const clientSecret = process.env.GMAIL_CLIENT_SECRET

    if (!clientId || !clientSecret) {
        console.error(
            "❌ GMAIL_CLIENT_ID と GMAIL_CLIENT_SECRET を設定してから実行してください。\n" +
                "   Google Cloud コンソールの「APIとサービス > 認証情報」で、種類「デスクトップアプリ」の\n" +
                "   OAuth クライアント ID を作ると発行されます。Gmail API の有効化も必要です。"
        )
        process.exitCode = 1
        return
    }

    const authorizeUrl =
        GOOGLE_AUTH_URL +
        "?" +
        new URLSearchParams({
            client_id: clientId,
            redirect_uri: REDIRECT_URI,
            response_type: "code",
            scope: GMAIL_SCOPE,
            // リフレッシュトークンは初回の同意でしか返らない。取り直せるよう毎回同意を求める。
            access_type: "offline",
            prompt: "consent",
        }).toString()

    console.log("\n1. 手元のブラウザで次のURLを開き、Gmailの読み取りを許可してください。\n")
    console.log(`   ${authorizeUrl}\n`)
    console.log(
        `2. 許可すると ${REDIRECT_URI} へ戻されます（ページは表示できなくて構いません）。\n` +
            "   そのときのアドレスバーのURLを、まるごと下へ貼り付けてください。\n"
    )

    const readline = createInterface({ input: process.stdin, output: process.stdout })
    const answer = (await readline.question("戻り先のURL（または code）: ")).trim()
    readline.close()

    // URLまるごと貼れるようにする。codeだけを探して貼らせるのは間違いが起きやすい。
    let code = answer
    if (answer.includes("code=")) {
        code = new URL(answer).searchParams.get("code") ?? ""
    }
    if (!code) {
        throw new Error("認可コードを読み取れませんでした")
    }

    const response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: "authorization_code",
            redirect_uri: REDIRECT_URI,
        }).toString(),
    })

    const json = (await response.json()) as { refresh_token?: string; error_description?: string }
    if (!response.ok || !json.refresh_token) {
        throw new Error(
            "リフレッシュトークンを取得できませんでした" +
                (json.error_description ? `: ${json.error_description}` : "")
        )
    }

    console.log("\n✅ 取得できました。次の1行を `.env` に追記してください（値は秘密情報です）。\n")
    console.log(`GMAIL_REFRESH_TOKEN=${json.refresh_token}`)
    console.log(
        "\n設定後、`npx -y tsx scripts/gmail-oauth.ts --check` で接続を確かめてください。"
    )
}

async function main() {
    if (process.argv.includes("--check")) {
        await check()
        return
    }
    await obtainRefreshToken()
}

main().catch((error) => {
    console.error("❌", error instanceof Error ? error.message : error)
    process.exit(1)
})
