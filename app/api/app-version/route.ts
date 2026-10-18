import { NextResponse } from "next/server"

import { buildAppVersionBody } from "@/lib/app-version"

// CDN/ブラウザにキャッシュされると稼働中の版を取り違えるため常に動的に返す。
export const dynamic = "force-dynamic"

/**
 * 稼働しているコミットの SHA（Issue #754）。`deploy.yml` が `.env` へ書く `APP_COMMIT_SHA` を返す。
 * デプロイのヘルスチェックはこれが今回のコミットと一致するまで成功にしない
 * （旧版が HTTP 200 を返しているだけの状態を成功と見なさないため）。
 * issue-deck のリリース完了判定もこの値で稼働版を照合する。
 * 未ログインで 127.0.0.1 から取れるよう、`lib/public-paths.ts` で公開経路にしている。
 * 返すのはバージョンとコミットSHAだけで、どちらも公開リポジトリから分かる値。
 */
export async function GET() {
    return NextResponse.json(buildAppVersionBody(), {
        headers: { "Cache-Control": "no-store" },
    })
}
