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
    /**
     * 同一口座内に同名の銘柄が複数行ある場合の出現順（1始まり）。
     * Zaimは旧NISA・新NISA等の口座区分を表示しないため、行の順番でしか区別できない。
     */
    occurrence: number
    /** 同一口座内にある同名の行数。1なら順番指定は不要。 */
    occurrenceCount: number
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
    const parsed: ZaimBalance[] = []
    for (const entry of entries) {
        const name = collapseWhitespace(entry.name)
        const amount = parseYenAmount(entry.amount)
        if (!name || amount === null) continue
        parsed.push({ name, amount })
    }
    return parsed
}

/** 巡回結果の生テキストを、金額を数値化した取得結果へ変換する。 */
export function buildZaimSnapshot(raw: ZaimRawScrapeResult): ZaimSnapshot {
    // 同じ銘柄が特定口座・NISA等で複数行に分かれることがある。
    // Zaimは口座区分を表示しないため合算せず、出現順を持たせて行単位で区別できるようにする。
    const holdings: ZaimHolding[] = []
    const occurrenceCounts = new Map<string, number>()
    const holdingKey = (account: string, name: string) =>
        `${toMatchKey(account)} ${toMatchKey(name)}`

    for (const page of raw.securities ?? []) {
        const account = collapseWhitespace(page.account || page.url)
        if (!account) continue

        for (const holding of parseEntries(page.holdings)) {
            const key = holdingKey(account, holding.name)
            const occurrence = (occurrenceCounts.get(key) ?? 0) + 1
            occurrenceCounts.set(key, occurrence)
            holdings.push({
                account,
                name: holding.name,
                amount: holding.amount,
                occurrence,
                occurrenceCount: 0,
            })
        }
    }

    for (const holding of holdings) {
        holding.occurrenceCount =
            occurrenceCounts.get(holdingKey(holding.account, holding.name)) ?? 1
    }

    // 残高一覧は口座ごとに1行のため、同名が複数現れた場合は最初の1件を採用する。
    const balances: ZaimBalance[] = []
    const seenBalances = new Set<string>()
    for (const balance of parseEntries(raw.balances)) {
        const key = toMatchKey(balance.name)
        if (seenBalances.has(key)) continue
        seenBalances.add(key)
        balances.push(balance)
    }

    return { balances, holdings }
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
