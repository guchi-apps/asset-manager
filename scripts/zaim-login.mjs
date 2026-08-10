import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { loadPlaywright } from "./zaim-playwright-loader.mjs"

const POLL_INTERVAL_MS = 3_000
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

/** 認証Cookieとして有効期間を報告する対象 */
const AUTH_COOKIE_NAMES = ["kf", "kufu"]

function isZaimHost(url) {
    try {
        return /(^|\.)zaim\.net$/.test(new URL(url).hostname)
    } catch {
        return false
    }
}

/**
 * ログイン完了の判定。Cookie名は変わりうるため、
 * 実際に残高ページを開けるか（サインイン画面へ飛ばされないか）で判定する。
 */
async function canOpenBalancePage(context, balanceUrl) {
    const page = await context.newPage()
    try {
        await page.goto(balanceUrl, { waitUntil: "domcontentloaded", timeout: 30_000 })
        if (!isZaimHost(page.url())) return false

        const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ")
        return /残高|総残高|評価額/.test(bodyText)
    } catch {
        return false
    } finally {
        await page.close()
    }
}

const { chromium } = await loadPlaywright()
const loginUrl = process.env.ZAIM_LOGIN_URL || "https://zaim.net/"
const balanceUrl = process.env.ZAIM_BALANCE_URL || "https://zaim.net/home"
const statePath = resolve(process.env.ZAIM_STORAGE_STATE_PATH || ".zaim/storage-state.json")
const timeoutMs = Number(process.env.ZAIM_LOGIN_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)

await mkdir(dirname(statePath), { recursive: true })

const browser = await chromium.launch({ headless: false })
const context = await browser.newContext()
const page = await context.newPage()

console.log(`Zaimを開きます: ${loginUrl}`)
console.log("表示されたブラウザでログインを完了してください。")
console.log(`ログイン後に ${balanceUrl} を開けるようになったら、自動で保存して終了します。`)

try {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" })

    const deadline = Date.now() + timeoutMs
    let signedIn = false

    while (Date.now() < deadline) {
        // ログイン手続き中に確認ページを開くと邪魔になるため、
        // zaim.net へ戻ってきてから残高ページの確認を試みる。
        if (isZaimHost(page.url()) && (await canOpenBalancePage(context, balanceUrl))) {
            signedIn = true
            break
        }
        await page.waitForTimeout(POLL_INTERVAL_MS)
    }

    if (!signedIn) {
        throw new Error(
            `ログインを検知できませんでした（${Math.round(timeoutMs / 60000)}分でタイムアウト）。`
        )
    }

    await context.storageState({ path: statePath })
    console.log(`ログイン状態を保存しました: ${statePath}`)

    // 同期間隔はこの有効期間より短くする必要があるため、測定結果を表示する。
    const cookies = await context.cookies()
    for (const name of AUTH_COOKIE_NAMES) {
        const cookie = cookies.find((item) => item.name === name)
        if (!cookie) continue
        if (!cookie.expires || cookie.expires < 0) {
            console.log(`  ${name}: ブラウザセッション限り`)
            continue
        }
        const hours = (cookie.expires - Date.now() / 1000) / 3600
        console.log(`  ${name}: 残り約${hours.toFixed(1)}時間`)
    }
    console.log("同期間隔は、上記のうち最も短い有効期間より短く設定してください。")
} finally {
    await browser.close()
}
