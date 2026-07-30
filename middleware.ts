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

export default async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl
    const { supabase, getResponse } = createProxyClient(request)
    const {
        data: { user },
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
        return redirectToLogin(request)
    }

    return attachPathHeader(getResponse(), pathname)
}

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|_next/webpack-hmr).*)",
    ],
}
