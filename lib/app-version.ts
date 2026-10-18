import packageJson from "../package.json"

/** 稼働中のアプリのバージョン（package.json の version）。 */
export const APP_VERSION: string = packageJson.version

/** `/api/app-version` のパス。middleware の公開経路と同じ値（app/sw.ts の除外は直書き）（Issue #754）。 */
export const APP_VERSION_PATH = "/api/app-version"

export type AppVersionBody = {
    version: string
    sha: string | null
}

/**
 * `/api/app-version` が返す本文を組み立てる。
 * `sha` は `deploy.yml` が `.env` へ書く `APP_COMMIT_SHA`。未設定（ローカル開発など）や空文字なら null。
 */
export function buildAppVersionBody(env: Record<string, string | undefined> = process.env): AppVersionBody {
    const sha = env.APP_COMMIT_SHA?.trim()
    return { version: APP_VERSION, sha: sha ? sha : null }
}
