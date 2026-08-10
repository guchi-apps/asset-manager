import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

// 証券詳細ページを順に巡回するため、1ページ分より長い実行時間を許容する。
const SCRAPE_TIMEOUT_MS = 300_000

export interface ZaimBalance {
    name: string
    amount: number
}

export interface ZaimRawEntry {
    name: string
    amount: string
}

export interface ZaimSecuritiesPage {
    url: string
    holdings: ZaimRawEntry[]
}

interface ScrapeResult {
    url: string
    balances: ZaimRawEntry[]
    securities: ZaimSecuritiesPage[]
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

/**
 * 残高一覧と証券詳細ページの取得結果を、評価額反映用の一覧へまとめる。
 *
 * - 同名の残高とholdingがある場合はholdingを優先する（残高側は証券口座の合計のため）
 * - 複数の証券口座に同じ銘柄がある場合は評価額を合算する
 */
export function mergeZaimEntries(
    balances: ZaimRawEntry[],
    securities: ZaimSecuritiesPage[]
): ZaimBalance[] {
    const holdingTotals = new Map<string, ZaimBalance>()
    for (const securitiesPage of securities) {
        for (const holding of parseEntries(securitiesPage.holdings)) {
            const key = toMatchKey(holding.name)
            const current = holdingTotals.get(key)
            if (current) {
                current.amount += holding.amount
                continue
            }
            holdingTotals.set(key, { ...holding })
        }
    }

    const merged: ZaimBalance[] = []
    const usedKeys = new Set<string>()
    for (const balance of parseEntries(balances)) {
        const key = toMatchKey(balance.name)
        if (usedKeys.has(key)) continue
        usedKeys.add(key)
        merged.push(holdingTotals.get(key) ?? balance)
    }
    for (const [key, holding] of holdingTotals) {
        if (usedKeys.has(key)) continue
        usedKeys.add(key)
        merged.push(holding)
    }

    return merged
}

export async function scrapeZaimBalances(): Promise<ZaimBalance[]> {
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

        const result = JSON.parse(stdout) as ScrapeResult
        if (!Array.isArray(result.balances)) {
            throw new Error("Invalid Zaim scraper response")
        }
        return mergeZaimEntries(result.balances, result.securities ?? [])
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes("ZAIM_SESSION_EXPIRED")) {
            throw new Error("Zaim login session expired. Run scripts/zaim-login.mjs again.")
        }
        throw error
    }
}
