const PUBLIC_PATH_PREFIXES = [
    "/auth/callback",
    "/auth/verify",
    "/auth/reset-password",
    "/auth/confirm-email-change",
    "/auth/confirm-password-change",
    "/terms",
    "/privacy",
]

const PUBLIC_PATHS = new Set([
    "/login",
    // cron等から呼ぶ同期API。セッションではなく ZAIM_SYNC_SECRET のBearer認証で保護する。
    "/api/zaim/sync",
    "/icon.svg",
    "/favicon.ico",
    "/manifest.json",
    "/robots.txt",
    "/sitemap.xml",
    "/sw.js",
])

/** サイドバー不要・セッション取得を省略してよいページ（表示速度優先） */
const SESSION_SKIP_PATHS = new Set(["/login"])

const SESSION_SKIP_PREFIXES = ["/auth/"]

export function isPublicPath(pathname: string): boolean {
    if (PUBLIC_PATHS.has(pathname)) return true
    if (pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot)$/)) return true
    return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

export function shouldSkipServerSession(pathname: string): boolean {
    if (SESSION_SKIP_PATHS.has(pathname)) return true
    return SESSION_SKIP_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}
