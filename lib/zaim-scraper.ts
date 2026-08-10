import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface ZaimBalance {
    name: string
    amount: number
    source: "home" | "securityHolding"
    url: string
}

interface ScrapeResult {
    balances: ZaimBalance[]
    url: string
    securitiesUrls: string[]
}

export async function scrapeZaimBalances(): Promise<ZaimBalance[]> {
    try {
        const { stdout } = await execFileAsync(
            process.execPath,
            ["scripts/zaim-scrape.mjs"],
            {
                cwd: process.cwd(),
                env: process.env,
                timeout: 5 * 60_000,
                maxBuffer: 1024 * 1024,
            }
        )

        const result = JSON.parse(stdout) as ScrapeResult
        if (!Array.isArray(result.balances)) {
            throw new Error("Invalid Zaim scraper response")
        }
        return result.balances
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes("ZAIM_SESSION_EXPIRED")) {
            throw new Error("Zaim login session expired. Run scripts/zaim-login.mjs again.")
        }
        throw error
    }
}
