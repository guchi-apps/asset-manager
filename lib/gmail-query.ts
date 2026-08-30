/**
 * Gmail取り込みの検索式の組み立てと、本文のテキスト化（Issue #271）。
 *
 * 「どのメールを取り込むか」は利用者が画面で登録した条件（差出人・件名）だけで決める。
 * AIに「購入っぽいメール」を判定させないのは、関係の無いメールから明細を作ると
 * 家計簿に無い支出が生まれるため。条件に合わないメールはそもそも取得しない。
 *
 * このモジュールはネットワークもDBも触らない純粋な変換だけを持つ。
 */

export interface GmailSearchCondition {
    /** 差出人。`from:` に入れる。 */
    fromQuery: string
    /** 件名。`subject:` に入れる。 */
    subjectQuery: string
    /** そのまま検索式へ足す追加の語。 */
    extraQuery: string
    /** 遡る日数。 */
    lookbackDays: number
}

/**
 * 検索語を1つの項目としてGmailへ渡す。
 *
 * Gmailの検索式は空白を「AND」として扱うため、`ご利用のお知らせ` のような空白を含む語を
 * そのまま入れると別々の条件に割れる。二重引用符で囲んで1語にまとめる。
 * 値の中の二重引用符は落とす（エスケープの方法がなく、残すと式が壊れるため）。
 */
export function quoteSearchTerm(value: string): string {
    const trimmed = value.trim().replace(/"/g, "")
    if (!trimmed) return ""
    return '"' + trimmed + '"'
}

/**
 * 条件から Gmail の検索式を作る。
 *
 * `newer_than` で期間を絞るのは、条件だけだと過去のメールを毎回すべて取りに行くため。
 * 取り込み済みの判定はメッセージidで行うので、期間は「新しく届いたぶんを拾う」ための目安。
 */
export function buildGmailQuery(condition: GmailSearchCondition): string {
    const parts: string[] = []

    const from = quoteSearchTerm(condition.fromQuery)
    if (from) parts.push("from:" + from)

    const subject = quoteSearchTerm(condition.subjectQuery)
    if (subject) parts.push("subject:" + subject)

    const extra = condition.extraQuery.trim()
    if (extra) parts.push(extra)

    const days = Number.isInteger(condition.lookbackDays) && condition.lookbackDays > 0
        ? condition.lookbackDays
        : 30
    parts.push("newer_than:" + days + "d")

    return parts.join(" ")
}

/** 差出人も件名も追加語も空の条件は、受信箱すべてが対象になってしまうので保存させない。 */
export function validateGmailRule(input: {
    name: string
    fromQuery: string
    subjectQuery: string
    extraQuery: string
    lookbackDays: number
}): string | null {
    if (!input.name.trim()) return "条件の名前を入力してください"
    if (!input.fromQuery.trim() && !input.subjectQuery.trim() && !input.extraQuery.trim()) {
        return "差出人・件名・追加の検索語のうち、少なくとも1つを入力してください"
    }
    if (!Number.isInteger(input.lookbackDays) || input.lookbackDays < 1 || input.lookbackDays > 365) {
        return "遡る日数は1〜365日で指定してください"
    }
    return null
}

/** Gmail APIが返すメッセージ本文の入れ子構造。必要な部分だけを型にしている。 */
export interface GmailMessagePart {
    mimeType?: string
    filename?: string
    headers?: Array<{ name?: string; value?: string }>
    body?: { size?: number; data?: string }
    parts?: GmailMessagePart[]
}

export interface GmailMessagePayload {
    headers?: Array<{ name?: string; value?: string }>
    mimeType?: string
    body?: { size?: number; data?: string }
    parts?: GmailMessagePart[]
}

/** ヘッダは大文字小文字が送信側の都合で揺れるため、比較は小文字に揃える。 */
export function findHeader(
    headers: Array<{ name?: string; value?: string }> | undefined,
    name: string
): string | null {
    if (!headers) return null
    const lowered = name.toLowerCase()
    for (const header of headers) {
        if (header.name?.toLowerCase() === lowered) return header.value ?? null
    }
    return null
}

/** Gmailのbase64url（`-` `_` を使い、パディングを省く）をUTF-8文字列へ戻す。 */
export function decodeBase64Url(data: string): string {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
    return Buffer.from(padded, "base64").toString("utf8")
}

/**
 * HTMLしか無いメールを、AIへ渡せる素のテキストにする。
 *
 * 完全なHTMLパーサは要らない。金額・品目・日付が読めれば足りるので、
 * 中身を読む必要が無い要素（script・style）を落とし、残ったタグを外して空白を詰める。
 */
export function htmlToText(html: string): string {
    return html
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
        .replace(/[ \t\u00a0\u3000]+/g, " ")
        // タグを空白へ落とすと行頭・行末に空白が残る（`<p>商品A</p><p>商品B</p>` など）。
        .replace(/[ \t]*\n[ \t]*/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

/**
 * 本文を取り出す。text/plain を優先し、無ければ text/html をテキスト化する。
 *
 * マルチパートは入れ子になることがある（`multipart/mixed` の中に `multipart/alternative`）ため、
 * 深さを問わず走査する。添付ファイル（`filename` があるパート）は本文ではないので見ない。
 */
export function extractMessageText(payload: GmailMessagePayload | undefined): string {
    if (!payload) return ""

    const plains: string[] = []
    const htmls: string[] = []

    const walk = (part: GmailMessagePart) => {
        if (part.filename) return

        const data = part.body?.data
        if (data) {
            const mimeType = part.mimeType ?? ""
            if (mimeType.startsWith("text/plain")) plains.push(decodeBase64Url(data))
            else if (mimeType.startsWith("text/html")) htmls.push(decodeBase64Url(data))
        }

        for (const child of part.parts ?? []) walk(child)
    }

    walk(payload as GmailMessagePart)

    if (plains.length > 0) return plains.join("\n").trim()
    if (htmls.length > 0) return htmlToText(htmls.join("\n"))
    return ""
}

/** AIへ渡す本文の上限。長いメールは末尾がフッタや広告なので、頭から切り取れば足りる。 */
export const MAX_MESSAGE_TEXT_LENGTH = 12_000

export function truncateMessageText(text: string): string {
    if (text.length <= MAX_MESSAGE_TEXT_LENGTH) return text
    return text.slice(0, MAX_MESSAGE_TEXT_LENGTH) + "\n…（以下省略）"
}
