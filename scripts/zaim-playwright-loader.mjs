import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

export async function loadPlaywright() {
    try {
        return await import("playwright")
    } catch {
        // Playwright はNext.js本体の依存に含めず、VPS/開発端末へ別途インストールする。
        // package-lock.jsonを肥大化させず、ブラウザ実行環境をWebアプリ本体から分離するため。
        const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim()
        const entry = join(globalRoot, "playwright", "index.mjs")
        if (!existsSync(entry)) {
            throw new Error(
                "Playwright is not installed. Run: npm install -g playwright && playwright install chromium"
            )
        }
        return import(pathToFileURL(entry).href)
    }
}
