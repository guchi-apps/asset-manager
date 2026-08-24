/**
 * スマートレシート・Amazon由来の明細をZaim上で見分ける（Issue #222 / #153 Phase 5・6）。
 *
 * Zaim APIの `GET /v2/home/money` が返す支出には「どの連携サービス由来か」を示す項目が無い
 * （`ZaimMoneyResponseItem` を参照）。一方で、Zaimの外部サービス連携は連携ごとに専用の口座を作る。
 * 実際の口座一覧にも「スマートレシート」「Amazon.co.jp」という口座が並んでいるため、
 * **`from_account_id` が連携口座と一致するかどうか**で由来を判定できる。
 *
 * `place` や `name` の文字列から推測する必要はない。文字列判定は店舗名が変わるたびに崩れるが、
 * 口座idは連携を貼り直さない限り変わらない。
 */

export type LinkedReceiptSource = "SMART_RECEIPT" | "AMAZON"

export const LINKED_RECEIPT_SOURCES: LinkedReceiptSource[] = ["SMART_RECEIPT", "AMAZON"]

export const LINKED_SOURCE_LABEL: Record<LinkedReceiptSource, string> = {
    SMART_RECEIPT: "スマートレシート",
    AMAZON: "Amazon",
}

/** 口座名からの自動判定。連携口座の既定名に合わせている。 */
const SOURCE_NAME_PATTERNS: Record<LinkedReceiptSource, RegExp> = {
    SMART_RECEIPT: /スマートレシート|smart\s*receipt/i,
    AMAZON: /amazon|アマゾン/i,
}

/** 環境変数で口座idを直接指定するときのキー。名前を変えている場合の逃げ道。 */
const SOURCE_ENV_KEYS: Record<LinkedReceiptSource, string> = {
    SMART_RECEIPT: "ZAIM_SMART_RECEIPT_ACCOUNT_ID",
    AMAZON: "ZAIM_AMAZON_ACCOUNT_ID",
}

export interface ZaimAccountRef {
    zaimAccountId: number
    name: string
}

export interface LinkedSourceAccount {
    source: LinkedReceiptSource
    zaimAccountId: number
    accountName: string
}

function parseAccountId(value: string | undefined): number | null {
    if (!value) return null
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** 環境変数で明示された連携口座id。未設定なら null。 */
export function getConfiguredLinkedAccountIds(): Partial<Record<LinkedReceiptSource, number>> {
    const configured: Partial<Record<LinkedReceiptSource, number>> = {}
    for (const source of LINKED_RECEIPT_SOURCES) {
        const id = parseAccountId(process.env[SOURCE_ENV_KEYS[source]])
        if (id !== null) configured[source] = id
    }
    return configured
}

/**
 * 取り込み済みの口座マスタから、連携由来の口座を割り出す。
 *
 * 環境変数の指定を最優先にし、無ければ口座名で拾う。口座名を変えていても環境変数で救えるように
 * しているが、既定の運用では設定を増やさずに動く（#221 の手順を増やさないため）。
 */
export function resolveLinkedSourceAccounts(
    accounts: ZaimAccountRef[],
    overrides: Partial<Record<LinkedReceiptSource, number>> = {}
): LinkedSourceAccount[] {
    const resolved: LinkedSourceAccount[] = []

    for (const source of LINKED_RECEIPT_SOURCES) {
        const overrideId = overrides[source]
        if (overrideId) {
            const named = accounts.find((account) => account.zaimAccountId === overrideId)
            resolved.push({
                source,
                zaimAccountId: overrideId,
                // マスタ未取得でも環境変数だけで動かせるよう、名前が引けなくても採用する。
                accountName: named?.name ?? LINKED_SOURCE_LABEL[source],
            })
            continue
        }

        const pattern = SOURCE_NAME_PATTERNS[source]
        const matched = accounts.filter((account) => pattern.test(account.name))
        // 同じ語を含む口座が複数あるときは、どれが連携口座か機械では決められない。
        // 誤った口座から取り込むと家計簿を壊すため、環境変数で指定してもらう。
        if (matched.length !== 1) continue

        resolved.push({
            source,
            zaimAccountId: matched[0].zaimAccountId,
            accountName: matched[0].name,
        })
    }

    return resolved
}

/** 口座id → 由来 の逆引き。明細のふるい分けに使う。 */
export function buildSourceByAccountId(
    accounts: LinkedSourceAccount[]
): Map<number, LinkedReceiptSource> {
    return new Map(accounts.map((account) => [account.zaimAccountId, account.source]))
}
