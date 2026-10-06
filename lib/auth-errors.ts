// Supabase Authの失敗を「今は確認できない」と「セッションが無効」に分ける（Issue #316・#641）。
//
// auth-jsは通信不達とHTTP 5xxをAuthRetryableFetchError（通信不達はstatus 0）で返す。
// 判定関数isAuthRetryableFetchError()は@supabase/supabase-jsから再公開されておらず、
// auth-jsを直接の依存に加えたくないため、同じ判定をここに置く。
// レート制限(429)も同じ扱いにする。時間をおけば通るもので、ログアウトさせる理由がない。
// 一方、古いrefresh token（400 refresh_token_not_found など）はセッションが無効になったもので、
// 再ログインで直る。こちらをエラー画面に留めると、利用者はいつまでもログインし直せない。
export function isAuthUnreachable(error: { name: string; status?: number } | null | undefined): boolean {
    if (!error) return false
    return error.name === "AuthRetryableFetchError" || error.status === 429
}
