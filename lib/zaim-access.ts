/**
 * Zaim連携を使えるユーザーの制限。
 *
 * 現在のZaimセッション（storage state）はサーバー上に1つしか持てないため、
 * 誰でもボタンを押せると他人のZaim残高が自分の資産として反映できてしまう。
 * それを防ぐため、許可したメールアドレスのユーザーだけが操作できるようにする。
 *
 * ユーザーごとにZaimを連携できるようにするまでの暫定措置。
 */

/** ZAIM_SYNC_USER_EMAIL は「,」区切りで複数のメールアドレスを設定できる。 */
export function getZaimAllowedEmails(): string[] {
    return (process.env.ZAIM_SYNC_USER_EMAIL ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
}

/** 未設定の場合は誰も使えない（fail-closed） */
export function isZaimAllowedEmail(email: string | null | undefined): boolean {
    if (!email) return false
    const allowed = getZaimAllowedEmails()
    if (allowed.length === 0) return false
    return allowed.includes(email.trim().toLowerCase())
}
