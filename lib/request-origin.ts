// next devを `-H 0.0.0.0` で起動しているため、Route Handlerの `request.url` は
// ホスト名が `0.0.0.0` になることがある。ブラウザが実際にアクセスしたホスト
// （localhost / WSLのLAN IP / sslip.io経由のスマホアクセス）を得るには、
// Hostヘッダーを見る必要がある。
export function resolveOrigin(headers: { get(name: string): string | null }, requestUrl?: string): string {
    // 本番はリバースプロキシ構成で常にHTTPSでのみ提供するため、X-Forwarded-Proto は
    // 信用せず固定でhttpsを使う。
    const isProduction = process.env.NODE_ENV === "production"
    const proto = isProduction ? "https" : (headers.get("x-forwarded-proto") ?? "http")
    const host = headers.get("x-forwarded-host") ?? headers.get("host")

    if (host && !host.startsWith("0.0.0.0")) {
        return `${proto}://${host}`
    }

    const port = (requestUrl && new URL(requestUrl).port) || process.env.PORT || "3000"
    return `${proto}://localhost:${port}`
}
