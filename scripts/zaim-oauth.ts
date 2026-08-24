import { createInterface } from "node:readline/promises"
import { buildAuthorizationHeader } from "../lib/zaim-oauth"
import {
    fetchZaimAccounts,
    ZAIM_ACCESS_TOKEN_URL,
    ZAIM_AUTHORIZE_URL,
    ZAIM_REQUEST_TOKEN_URL,
    getZaimApiCredentials,
} from "../lib/zaim-api"

/**
 * Zaim API のアクセストークンを取得する対話スクリプト（Issue #153）。
 *
 * OAuth 1.0a の認可はブラウザでしか完了できず、このサーバーにはGUIが無い。
 * そのため「URLを表示 → 手元のブラウザで許可 → 戻り先URLを貼る」という手順にしている。
 * 取得した値は表示するだけで、ファイルにもDBにも書かない（`.env` へ人が貼る）。
 *
 *   npx -y tsx scripts/zaim-oauth.ts            # アクセストークンを取得する
 *   npx -y tsx scripts/zaim-oauth.ts --accounts # 口座一覧（反映待ち口座のid探し）
 */

const CALLBACK_URL = process.env.ZAIM_OAUTH_CALLBACK_URL || "http://localhost:9153/zaim/callback"

function parseFormEncoded(text: string): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of new URLSearchParams(text).entries()) {
        result[key] = value
    }
    return result
}

async function postSigned(
    url: string,
    consumerKey: string,
    consumerSecret: string,
    options: {
        token?: string
        tokenSecret?: string
        extraOAuthParams?: Record<string, string>
    } = {}
): Promise<Record<string, string>> {
    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: buildAuthorizationHeader({
                method: "POST",
                url,
                consumerKey,
                consumerSecret,
                token: options.token,
                tokenSecret: options.tokenSecret,
                extraOAuthParams: options.extraOAuthParams,
            }),
        },
    })

    const text = await response.text()
    if (!response.ok) {
        throw new Error(`Zaim からエラーが返りました (HTTP ${response.status}): ${text}`)
    }
    return parseFormEncoded(text)
}

async function listAccounts() {
    const credentials = getZaimApiCredentials()
    if (!credentials) {
        console.error(
            "❌ ZAIM_CONSUMER_KEY / ZAIM_CONSUMER_SECRET / ZAIM_ACCESS_TOKEN / ZAIM_ACCESS_TOKEN_SECRET を設定してください"
        )
        process.exitCode = 1
        return
    }

    const accounts = await fetchZaimAccounts(credentials)
    console.log("Zaim の口座一覧（ZAIM_PENDING_ACCOUNT_ID にはこの id を設定します）\n")
    for (const account of accounts) {
        const state = account.active === 0 ? "（無効）" : ""
        console.log(`  ${String(account.id).padStart(8)}  ${account.name}${state}`)
    }
}

async function obtainAccessToken() {
    const consumerKey = process.env.ZAIM_CONSUMER_KEY
    const consumerSecret = process.env.ZAIM_CONSUMER_SECRET

    if (!consumerKey || !consumerSecret) {
        console.error(
            "❌ ZAIM_CONSUMER_KEY と ZAIM_CONSUMER_SECRET を設定してから実行してください。\n" +
                "   https://dev.zaim.net/ でアプリを登録すると発行されます。"
        )
        process.exitCode = 1
        return
    }

    const requestToken = await postSigned(ZAIM_REQUEST_TOKEN_URL, consumerKey, consumerSecret, {
        extraOAuthParams: { oauth_callback: CALLBACK_URL },
    })
    const token = requestToken.oauth_token
    const tokenSecret = requestToken.oauth_token_secret
    if (!token || !tokenSecret) {
        throw new Error("リクエストトークンを取得できませんでした")
    }

    console.log("\n1. 手元のブラウザで次のURLを開き、Zaimでの連携を許可してください。\n")
    console.log(`   ${ZAIM_AUTHORIZE_URL}?oauth_token=${token}\n`)
    console.log(
        `2. 許可すると ${CALLBACK_URL} へ戻されます（ページは表示できなくて構いません）。\n` +
            "   そのときのアドレスバーのURLを、まるごと下へ貼り付けてください。\n"
    )

    const readline = createInterface({ input: process.stdin, output: process.stdout })
    const answer = (await readline.question("戻り先のURL（または oauth_verifier）: ")).trim()
    readline.close()

    // URLまるごと貼れるようにする。verifierだけを探して貼らせるのは間違いが起きやすい。
    let verifier = answer
    if (answer.includes("oauth_verifier=")) {
        verifier = new URL(answer).searchParams.get("oauth_verifier") ?? ""
    }
    if (!verifier) {
        throw new Error("oauth_verifier を読み取れませんでした")
    }

    const accessToken = await postSigned(ZAIM_ACCESS_TOKEN_URL, consumerKey, consumerSecret, {
        token,
        tokenSecret,
        extraOAuthParams: { oauth_verifier: verifier },
    })

    if (!accessToken.oauth_token || !accessToken.oauth_token_secret) {
        throw new Error("アクセストークンを取得できませんでした")
    }

    console.log("\n✅ 取得できました。次の2行を `.env` に追記してください（値は秘密情報です）。\n")
    console.log(`ZAIM_ACCESS_TOKEN=${accessToken.oauth_token}`)
    console.log(`ZAIM_ACCESS_TOKEN_SECRET=${accessToken.oauth_token_secret}`)
    console.log(
        "\n設定後、`npx -y tsx scripts/zaim-oauth.ts --accounts` で口座一覧を出し、" +
            "「反映待ち」口座の id を ZAIM_PENDING_ACCOUNT_ID に設定してください。"
    )
}

async function main() {
    if (process.argv.includes("--accounts")) {
        await listAccounts()
        return
    }
    await obtainAccessToken()
}

main().catch((error) => {
    console.error("❌", error instanceof Error ? error.message : error)
    process.exit(1)
})
