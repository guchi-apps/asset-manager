import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { loadPlaywright } from "./zaim-playwright-loader.mjs"

const { chromium } = await loadPlaywright()
const loginUrl = process.env.ZAIM_LOGIN_URL || "https://zaim.net/"
const statePath = resolve(process.env.ZAIM_STORAGE_STATE_PATH || ".zaim/storage-state.json")

await mkdir(dirname(statePath), { recursive: true })

const browser = await chromium.launch({ headless: false })
const context = await browser.newContext()
const page = await context.newPage()

console.log(`Zaimを開きます: ${loginUrl}`)
console.log("ブラウザでログインを完了し、残高画面まで移動してください。")
console.log("完了したら、このターミナルで Enter を押してください。")

await page.goto(loginUrl, { waitUntil: "domcontentloaded" })
await new Promise((resolveInput) => {
    process.stdin.resume()
    process.stdin.once("data", resolveInput)
})

await context.storageState({ path: statePath })
console.log(`ログイン状態を保存しました: ${statePath}`)
await browser.close()
