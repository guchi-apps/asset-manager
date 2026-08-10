import { resolve } from "node:path"
import { loadPlaywright } from "./zaim-playwright-loader.mjs"

const PAGE_TIMEOUT = 60_000
const DEFAULT_SECURITIES_LINK_SELECTOR = 'a[href*="/securities/"]'
const ACCOUNT_NAME_MAX_LENGTH = 60

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

// 証券詳細ページへのリンクから、遷移先URLと口座名の候補を取り出す。
// リンクが行全体を包んでいる場合はテキストに金額が含まれるため、金額部分は落とす。
function extractSecuritiesLinks(links) {
    return links
        .map((link) => ({
            url: link.href,
            name: (link.textContent ?? "")
                .replace(/[￥¥]\s*-?[\d,]+/g, " ")
                .replace(/\s+/g, " ")
                .trim(),
        }))
        .filter((link) => Boolean(link.url))
}

async function extractPairs(page, selectors) {
    if (selectors.row && selectors.name && selectors.amount) {
        return page
            .locator(selectors.row)
            .evaluateAll(extractRowPairs, { name: selectors.name, amount: selectors.amount })
    }
    return page.locator("tr, li, article, section, a, div").evaluateAll(extractGenericPairs)
}

/**
 * 証券口座名を決める。銘柄は口座ごとに分けて対応付けるため、
 * どの口座の銘柄かを示す名前が必須になる。
 */
async function resolveAccountName(page, linkName, accountNameSelector) {
    if (accountNameSelector) {
        const heading = page.locator(accountNameSelector).first()
        if ((await heading.count()) > 0) {
            const text = collapseWhitespace(await heading.innerText())
            if (text) return text
        }
    }
    if (linkName && linkName.length <= ACCOUNT_NAME_MAX_LENGTH) return linkName
    const title = collapseWhitespace(await page.title())
    if (title) return title
    return page.url()
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
const accountNameSelector = process.env.ZAIM_SECURITIES_ACCOUNT_NAME_SELECTOR

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ storageState: statePath })
const page = await context.newPage()

try {
    await page.goto(balanceUrl, { waitUntil: "networkidle", timeout: PAGE_TIMEOUT })
    await assertLoggedIn(page)

    const balances = await extractPairs(page, balanceSelectors)

    // 証券は残高一覧に合計しか出ないため、詳細ページを巡回して個別銘柄を取得する。
    const securitiesLinks = await page
        .locator(securitiesLinkSelector)
        .evaluateAll(extractSecuritiesLinks)

    // 同じ口座へのリンクが複数あることがあるため、URL単位で1回だけ巡回する。
    const linkNameByUrl = new Map()
    for (const link of securitiesLinks) {
        if (!linkNameByUrl.get(link.url)) linkNameByUrl.set(link.url, link.name)
    }

    const securities = []
    for (const [securitiesUrl, linkName] of linkNameByUrl) {
        await page.goto(securitiesUrl, { waitUntil: "networkidle", timeout: PAGE_TIMEOUT })
        await assertLoggedIn(page)
        const account = await resolveAccountName(page, linkName, accountNameSelector)
        const holdings = await extractPairs(page, holdingSelectors)
        securities.push({ url: securitiesUrl, account, holdings })
    }

    process.stdout.write(JSON.stringify({ url: balanceUrl, balances, securities }))
} finally {
    await browser.close()
}
