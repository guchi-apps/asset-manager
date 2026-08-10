import { resolve } from "node:path"
import { loadPlaywright } from "./zaim-playwright-loader.mjs"
import { mergeBalances, normalizeItems } from "./zaim-extract.mjs"

function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim()
}

const { chromium } = await loadPlaywright()
const statePath = resolve(process.env.ZAIM_STORAGE_STATE_PATH || ".zaim/storage-state.json")
const balanceUrl = process.env.ZAIM_BALANCE_URL
if (!balanceUrl) throw new Error("ZAIM_BALANCE_URL is not configured")

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ storageState: statePath })
const page = await context.newPage()

async function assertLoggedIn(targetPage) {
    const currentUrl = targetPage.url()
    const bodyText = normalizeText(await targetPage.locator("body").innerText())
    if (/ログイン|メールアドレス|パスワード/.test(bodyText) && !/残高|総残高/.test(bodyText)) {
        throw new Error(`ZAIM_SESSION_EXPIRED:${currentUrl}`)
    }
}

async function extractRows(targetPage, rowSelector, nameSelector, amountSelector, { excludeSecurityLinks = false } = {}) {
    return targetPage.locator(rowSelector).evaluateAll(
        (rows, options) => rows
            .filter((row) => !options.excludeSecurityLinks || !row.querySelector('a[href*="/securities/"]'))
            .map((row) => ({
                name: row.querySelector(options.name)?.textContent?.replace(/\s+/g, " ").trim() ?? "",
                amount: row.querySelector(options.amount)?.textContent?.replace(/\s+/g, " ").trim() ?? "",
            })),
        { name: nameSelector, amount: amountSelector, excludeSecurityLinks }
    )
}

async function extractGeneric(targetPage, { excludeSecurityLinks = false } = {}) {
    return targetPage.locator("tr, li, article, section, a, div").evaluateAll((elements, options) => {
        const yenPattern = /[￥¥]\s*-?[\d,]+/
        const candidates = []
        for (const element of elements) {
            if (options.excludeSecurityLinks &&
                (element.matches('a[href*="/securities/"]') || element.querySelector('a[href*="/securities/"]'))) continue
            const text = element.textContent?.replace(/\s+/g, " ").trim() ?? ""
            if (!text || text.length > 180 || !yenPattern.test(text)) continue
            const match = text.match(yenPattern)
            if (!match) continue
            const name = text.replace(match[0], " ").replace(/\s+/g, " ").trim()
            if (!name || name.length > 80) continue
            candidates.push({ name, amount: match[0] })
        }
        return candidates
    }, { excludeSecurityLinks })
}

try {
    await page.goto(balanceUrl, { waitUntil: "networkidle", timeout: 60_000 })
    await assertLoggedIn(page)
    const homeUrl = page.url()

    const rowSelector = process.env.ZAIM_BALANCE_ROW_SELECTOR
    const nameSelector = process.env.ZAIM_BALANCE_NAME_SELECTOR
    const amountSelector = process.env.ZAIM_BALANCE_AMOUNT_SELECTOR
    const homeItems = rowSelector && nameSelector && amountSelector
        ? await extractRows(page, rowSelector, nameSelector, amountSelector, { excludeSecurityLinks: true })
        : await extractGeneric(page, { excludeSecurityLinks: true })

    const linkSelector = process.env.ZAIM_SECURITIES_LINK_SELECTOR || 'a[href*="/securities/"]'
    const securitiesUrls = await page.locator(linkSelector).evaluateAll((links) =>
        [...new Set(links.map((link) => link.href).filter(Boolean))]
    )
    const holdingRowSelector = process.env.ZAIM_SECURITIES_HOLDING_ROW_SELECTOR
    const holdingNameSelector = process.env.ZAIM_SECURITIES_HOLDING_NAME_SELECTOR
    const holdingAmountSelector = process.env.ZAIM_SECURITIES_HOLDING_AMOUNT_SELECTOR
    const holdings = []

    for (const securitiesUrl of securitiesUrls) {
        await page.goto(securitiesUrl, { waitUntil: "networkidle", timeout: 60_000 })
        await assertLoggedIn(page)
        const extracted = holdingRowSelector && holdingNameSelector && holdingAmountSelector
            ? await extractRows(page, holdingRowSelector, holdingNameSelector, holdingAmountSelector)
            : await extractGeneric(page)
        holdings.push(...normalizeItems(extracted, "securityHolding", page.url()))
    }

    const balances = mergeBalances(normalizeItems(homeItems, "home", homeUrl), holdings)
    process.stdout.write(JSON.stringify({ balances, url: homeUrl, securitiesUrls }))
} finally {
    await browser.close()
}
