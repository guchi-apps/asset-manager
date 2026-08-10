import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

// 証券詳細ページを順に巡回するため、1ページ分より長い実行時間を許容する。
const SCRAPE_TIMEOUT_MS = 300_000

export interface ZaimBalance {
    name: string
    amount: number
}

export interface ZaimHolding {
    /** 証券口座名。同じ銘柄を口座ごとに分けて対応付けるために保持する。 */
    account: string
    name: string
    amount: number
}

export interface ZaimSnapshot {
    balances: ZaimBalance[]
    holdings: ZaimHolding[]
}

export interface ZaimRawEntry {
    name: string
    amount: string
}

export interface ZaimRawSecuritiesPage {
    url: string
    account: string
    holdings: ZaimRawEntry[]
}

export interface ZaimRawScrapeResult {
    url: string
    balances: ZaimRawEntry[]
    securities: ZaimRawSecuritiesPage[]
}

export function collapseWhitespace(text: string): string {
    return text.replace(/\s+/g, " ").trim()
}

/**
 * 照合用キー。ZaimのDOMは名称の途中で要素が分かれ「楽天カー ド」のように
 * 空白・改行が混ざるため、空白を完全に除去した文字列で突き合わせる。
 */
export function toMatchKey(text: string): string {
    return text.replace(/\s+/g, "")
}

export function parseYenAmount(text: string): number | null {
    const normalized = text
        .replace(/[￥¥]/g, "")
        .replace(/,/g, "")
        .replace(/\s/g, "")
        .trim()
    if (!/^-?\d+$/.test(normalized)) return null
    const value = Number(normalized)
    return Number.isFinite(value) ? value : null
}

function parseEntries(entries: ZaimRawEntry[]): ZaimBalance[] {
    // 汎用抽出は入れ子要素から同じ行を重複して拾うため、
    // 同一ページ内の「名称 + 金額」が完全に一致する組は1件に畳む。
    const seen = new Set<string>()
    const parsed: ZaimBalance[] = []
    for (const entry of entries) {
        const name = collapseWhitespace(entry.name)
        const amount = parseYenAmount(entry.amount)
        if (!name || amount === null) continue
        const key = `${toMatchKey(name)} ${amount}`
        if (seen.has(key)) continue
        seen.add(key)
        parsed.push({ name, amount })
    }
    return parsed
}

/** 巡回結果の生テキストを、金額を数値化した取得結果へ変換する。 */
export function buildZaimSnapshot(raw: ZaimRawScrapeResult): ZaimSnapshot {
    const holdings: ZaimHolding[] = []
    for (const page of raw.securities ?? []) {
        const account = collapseWhitespace(page.account || page.url)
        if (!account) continue
        for (const holding of parseEntries(page.holdings)) {
            holdings.push({ account, name: holding.name, amount: holding.amount })
        }
    }

    return { balances: parseEntries(raw.balances), holdings }
}

export async function scrapeZaimSnapshot(): Promise<ZaimSnapshot> {
    try {
        const { stdout } = await execFileAsync(
            process.execPath,
            ["scripts/zaim-scrape.mjs"],
            {
                cwd: process.cwd(),
                env: process.env,
                timeout: SCRAPE_TIMEOUT_MS,
                maxBuffer: 8 * 1024 * 1024,
            }
        )

        const result = JSON.parse(stdout) as ZaimRawScrapeResult
        if (!Array.isArray(result.balances)) {
            throw new Error("Invalid Zaim scraper response")
        }
        return buildZaimSnapshot(result)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes("ZAIM_SESSION_EXPIRED")) {
            throw new Error("Zaim login session expired. Run scripts/zaim-login.mjs again.")
        }
        throw error
    }
}
