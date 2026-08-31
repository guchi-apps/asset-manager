import { NextRequest, NextResponse } from "next/server"
import { createProxyClient } from "@/lib/supabase/proxy"
import { isPublicPath } from "@/lib/public-paths"

function attachPathHeader(response: NextResponse, pathname: string): NextResponse {
    response.headers.set("x-pathname", pathname)
    return response
}

function redirectToLogin(request: NextRequest): NextResponse {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl)
}

// auth-jsは通信不達とHTTP 5xxをAuthRetryableFetchError（通信不達はstatus 0）で返す。
// 判定関数isAuthRetryableFetchError()は@supabase/supabase-jsから再公開されておらず、
// auth-jsを直接の依存に加えたくないため、同じ判定をここに置く。
// レート制限(429)も同じ扱いにする。時間をおけば通るもので、ログアウトさせる理由がない。
// （セッションが無効なのではなく、今は確認できないだけのケース。car-care等の実装を踏襲）
function isAuthUnreachable(error: { name: string; status?: number } | null): boolean {
    if (!error) return false
    return error.name === "AuthRetryableFetchError" || error.status === 429
}

function serviceUnavailable(): NextResponse {
    return new NextResponse(
        `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Asset Manager</title>
  </head>
  <body style="font-family: system-ui, sans-serif; display: grid; place-items: center; height: 100dvh; margin: 0; text-align: center;">
    <div>
      <p>ログイン状態を確認できませんでした。</p>
      <p>通信状況を確認して、もう一度お試しください。</p>
      <p><a href="">再読み込み</a></p>
    </div>
  </body>
</html>
`,
        {
            status: 503,
            headers: {
                "Retry-After": "5",
                "Cache-Control": "no-store",
                "Content-Type": "text/html; charset=utf-8",
            },
        }
    )
}

export default async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl
    const { supabase, getResponse } = createProxyClient(request)
    const {
        data: { user },
        error,
    } = await supabase.auth.getUser()

    if (isPublicPath(pathname)) {
        if (pathname === "/login" || pathname === "/login/") {
            if (user) {
                return NextResponse.redirect(new URL("/", request.url))
            }
        }

        return attachPathHeader(getResponse(), pathname)
    }

    if (!user) {
        // 通信不達・5xx・レート制限でgetUser()が失敗した場合もuser: nullになるため、
        // errorを見ずに判定すると「今は確認できない」を「未ログイン」と取り違えてしまう。
        // PWAは起動のたびにネットワークスタックがコールドスタートし、この状態に陥りやすい。
        if (isAuthUnreachable(error)) {
            return serviceUnavailable()
        }
        return redirectToLogin(request)
    }

    return attachPathHeader(getResponse(), pathname)
}

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|_next/webpack-hmr).*)",
    ],
}
