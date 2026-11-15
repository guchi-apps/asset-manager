/** Morrowの本番URL。環境変数にはせず固定する（Secrets・本番設定を増やさないため。Issue #1456） */
export const MORROW_BASE_URL = "https://aide-bot.gucchii.com"

/** Morrowの `isMailMessageId`（`/mail/[id]` が通す形）と同じ。合わないIDはMorrowが404にする */
const MAIL_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_.~-]{1,320}$/

/**
 * 取り込んだGmailメール（`gmailMessageId`）をMorrowで開くURL。
 * Morrowの形に合わないIDは null を返し、呼び出し側はリンクを出さない。
 */
export function buildMorrowMailUrl(messageId: string | null | undefined): string | null {
    if (typeof messageId !== "string" || !MAIL_MESSAGE_ID_PATTERN.test(messageId)) return null
    return `${MORROW_BASE_URL}/mail/${encodeURIComponent(messageId)}`
}
