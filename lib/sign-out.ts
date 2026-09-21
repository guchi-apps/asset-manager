// Supabase Authのsign outは、scopeを省略すると"global"になり、同じユーザーの
// 全アプリ・全端末のrefresh tokenを失効させる。このプロジェクトのSupabaseは
// 他のアプリと共有しているため、ログアウトしたのがこのアプリだけでも
// 他アプリのログインまで切れてしまう（guchi-apps/issue-deck#3235）。
//
// このアプリのセッションだけを破棄するために、必ず"local"を明示する。
// サインアウトの呼び出しは、直接 supabase.auth.signOut() を書かずここを通す。
export interface SignOutClient {
    auth: {
        signOut(options: { scope: "local" }): Promise<unknown>
    }
}

export async function signOutLocal(supabase: SignOutClient): Promise<void> {
    await supabase.auth.signOut({ scope: "local" })
}
