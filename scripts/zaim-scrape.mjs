import { resolve } from "node:path"
import { loadPlaywright } from "./zaim-playwright-loader.mjs"

const PAGE_TIMEOUT = 60_000
const DEFAULT_SECURITIES_LINK_SELECTOR = 'a[href*="/securities/"]'

function collapseWhitespace(text) {
    return text.replace(/\s+/g, " ").trim()
}

// DOM構造が変わっても最低限拾えるよう、小さな表示ブロックから
// 「名称 + 円金額」の組を抽出する。実運用ではセレクタ指定を推奨する。
function extractGenericPairs(elements) {
    const yenPattern = /[￥¥]\s*-?[\d,]+/
    const candidates = []
    for (const element of elements) {
        const text = element.textContent?.replace(/\s+/g, " ").trim() ?? ""
        if (!text || text.length > 180 || !yenPattern.test(text)) continue
        const match = text.match(yenPattern)
        if (!match) continue
        const name = text.replace(match[0], " ").replace(/\s+/g, " ").trim()
        if (!name || name.length > 80) continue
        candidates.push({ name, amount: match[0] })
    }
    return candidates
}

function extractRowPairs(rows, selectors) {
    return rows.map((row) => ({
        name: row.querySelector(selectors.name)?.textContent ?? "",
        amount: row.querySelector(selectors.amount)?.textContent ?? "",
    }))
}

async function extractPairs(page, selectors) {
    if (selectors.row && selectors.name && selectors.amount) {
        return page
            .locator(selectors.row)
            .evaluateAll(extractRowPairs, { name: selectors.name, amount: selectors.amount })
    }
    return page.locator("tr, li, article, section, a, div").evaluateAll(extractGenericPairs)
}

async function assertLoggedIn(page) {
    const bodyText = collapseWhitespace(await page.locator("body").innerText())
    if (/ログイン|メールアドレス|パスワード/.test(bodyText) && !/残高|総残高|評価額/.test(bodyText)) {
        throw new Error(`ZAIM_SESSION_EXPIRED:${page.url()}`)
    }
}

const { chromium } = await loadPlaywright()
const statePath = resolve(process.env.ZAIM_STORAGE_STATE_PATH || ".zaim/storage-state.json")
const balanceUrl = process.env.ZAIM_BALANCE_URL

if (!balanceUrl) {
    throw new Error("ZAIM_BALANCE_URL is not configured")
}

const balanceSelectors = {
    row: process.env.ZAIM_BALANCE_ROW_SELECTOR,
    name: process.env.ZAIM_BALANCE_NAME_SELECTOR,
    amount: process.env.ZAIM_BALANCE_AMOUNT_SELECTOR,
}
const holdingSelectors = {
    row: process.env.ZAIM_SECURITIES_HOLDING_ROW_SELECTOR,
    name: process.env.ZAIM_SECURITIES_HOLDING_NAME_SELECTOR,
    amount: process.env.ZAIM_SECURITIES_HOLDING_AMOUNT_SELECTOR,
}
const securitiesLinkSelector =
    process.env.ZAIM_SECURITIES_LINK_SELECTOR || DEFAULT_SECURITIES_LINK_SELECTOR

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ storageState: statePath })
const page = await context.newPage()

try {
    await page.goto(balanceUrl, { waitUntil: "networkidle", timeout: PAGE_TIMEOUT })
    await assertLoggedIn(page)

    const balances = await extractPairs(page, balanceSelectors)

    // 証券は残高一覧に合計しか出ないため、詳細ページを巡回して個別銘柄を取得する。
    const securitiesUrls = await page
        .locator(securitiesLinkSelector)
        .evaluateAll((links) => links.map((link) => link.href).filter(Boolean))
    const uniqueSecuritiesUrls = [...new Set(securitiesUrls)]

    const securities = []
    for (const securitiesUrl of uniqueSecuritiesUrls) {
        await page.goto(securitiesUrl, { waitUntil: "networkidle", timeout: PAGE_TIMEOUT })
        await assertLoggedIn(page)
        const holdings = await extractPairs(page, holdingSelectors)
        securities.push({ url: securitiesUrl, holdings })
    }

    process.stdout.write(JSON.stringify({ url: balanceUrl, balances, securities }))
} finally {
    await browser.close()
}
