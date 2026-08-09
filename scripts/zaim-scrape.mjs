import { resolve } from "node:path"
import { loadPlaywright } from "./zaim-playwright-loader.mjs"

function parseYen(text) {
    const normalized = text
        .replace(/[￥¥]/g, "")
        .replace(/,/g, "")
        .replace(/\s/g, "")
        .trim()
    if (!/^-?\d+$/.test(normalized)) return null
    const value = Number(normalized)
    return Number.isFinite(value) ? value : null
}

function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim()
}

const { chromium } = await loadPlaywright()
const statePath = resolve(process.env.ZAIM_STORAGE_STATE_PATH || ".zaim/storage-state.json")
const balanceUrl = process.env.ZAIM_BALANCE_URL

if (!balanceUrl) {
    throw new Error("ZAIM_BALANCE_URL is not configured")
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ storageState: statePath })
const page = await context.newPage()

try {
    await page.goto(balanceUrl, { waitUntil: "networkidle", timeout: 60_000 })

    const currentUrl = page.url()
    const bodyText = normalizeText(await page.locator("body").innerText())
    if (/ログイン|メールアドレス|パスワード/.test(bodyText) && !/残高|総残高/.test(bodyText)) {
        throw new Error(`ZAIM_SESSION_EXPIRED:${currentUrl}`)
    }

    const rowSelector = process.env.ZAIM_BALANCE_ROW_SELECTOR
    const nameSelector = process.env.ZAIM_BALANCE_NAME_SELECTOR
    const amountSelector = process.env.ZAIM_BALANCE_AMOUNT_SELECTOR

    let balances = []

    if (rowSelector && nameSelector && amountSelector) {
        balances = await page.locator(rowSelector).evaluateAll(
            (rows, selectors) => rows.map((row) => {
                const name = row.querySelector(selectors.name)?.textContent?.replace(/\s+/g, " ").trim() ?? ""
                const amount = row.querySelector(selectors.amount)?.textContent?.replace(/\s+/g, " ").trim() ?? ""
                return { name, amount }
            }),
            { name: nameSelector, amount: amountSelector }
        )
    } else {
        // DOM構造が変わっても最低限拾えるよう、小さな表示ブロックから
        // 「名称 + 円金額」の組を抽出する。実運用ではセレクタ指定を推奨する。
        balances = await page.locator("tr, li, article, section, a, div").evaluateAll((elements) => {
            const yenPattern = /[￥¥]\s*-?[\d,]+/
            const candidates = []
            for (const element of elements) {
                const text = element.textContent?.replace(/\s+/g, " ").trim() ?? ""
                if (!text || text.length > 180 || !yenPattern.test(text)) continue
                const match = text.match(yenPattern)
                if (!match) continue
                const amount = match[0]
                const name = text.replace(match[0], " ").replace(/\s+/g, " ").trim()
                if (!name || name.length > 80) continue
                candidates.push({ name, amount })
            }
            return candidates
        })
    }

    const seen = new Set()
    const normalized = []
    for (const item of balances) {
        const name = normalizeText(item.name)
        const amount = parseYen(item.amount)
        if (!name || amount === null) continue
        const key = `${name}\u0000${amount}`
        if (seen.has(key)) continue
        seen.add(key)
        normalized.push({ name, amount })
    }

    process.stdout.write(JSON.stringify({ balances: normalized, url: currentUrl }))
} finally {
    await browser.close()
}
