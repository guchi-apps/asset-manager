/**
 * スマートレシート・Amazon由来の明細をZaim上で見分ける（Issue #222 / #153 Phase 5・6）。
 *
 * Zaimの外部サービス連携は連携ごとに専用の口座を作る（口座一覧に「スマートレシート」「Amazon.co.jp」が並ぶ）。
 * そのため**出金元の口座がどの連携口座か**で由来を判定できる。
 *
 * 以前はZaim APIの口座マスタ（`ZaimAccount`）から連携口座の**id**を割り出し（環境変数
 * `ZAIM_SMART_RECEIPT_ACCOUNT_ID` / `ZAIM_AMAZON_ACCOUNT_ID` で上書きできた）、明細の `from_account_id` と
 * 照らしていた。Zaim APIの終了でマスタは更新されなくなったので（#788・#843）、いまは
 * **AIDEが読んだWeb版の一覧の口座名**だけで判定する。どの口座名を「情報源」とするかは家計簿の
 * 口座名の対応（`LedgerSourceAccountMapping`）を正とし、対応が無い名前は `guessAccount` の推定に従う。
 * スマートレシートかAmazonかは口座名の語で分ける。
 *
 * ここはDBに触らない純粋な判定だけを持つ。
 */

import { guessAccount, type AccountMappingTarget } from "@/lib/ledger-sources/mapping"

export type LinkedReceiptSource = "SMART_RECEIPT" | "AMAZON"

export const LINKED_RECEIPT_SOURCES: LinkedReceiptSource[] = ["SMART_RECEIPT", "AMAZON"]

export const LINKED_SOURCE_LABEL: Record<LinkedReceiptSource, string> = {
    SMART_RECEIPT: "スマートレシート",
    AMAZON: "Amazon",
}

/** 口座名からの判定。連携口座の既定名に合わせている（`guessAccount` の情報源の語と揃える）。 */
const SOURCE_NAME_PATTERNS: Record<LinkedReceiptSource, RegExp> = {
    SMART_RECEIPT: /スマートレシート|smart\s*receipt/i,
    AMAZON: /amazon|アマゾン/i,
}

/** 口座名がどの連携サービスの名前か。どちらでもなければ null。 */
export function linkedSourceOfName(name: string): LinkedReceiptSource | null {
    const normalized = name.normalize("NFKC")
    for (const source of LINKED_RECEIPT_SOURCES) {
        if (SOURCE_NAME_PATTERNS[source].test(normalized)) return source
    }
    return null
}

/** 口座名の対応表のうち、判定に使う部分（`LedgerSourceAccountMapping` の provider "zaim" の行）。 */
export interface LinkedAccountMappingRef {
    externalName: string
    target: AccountMappingTarget | string
}

export interface LinkedSourceAccount {
    source: LinkedReceiptSource
    /** Zaim Web版の一覧に出る口座名（表記のまま）。 */
    accountName: string
}

/**
 * Web版の一覧に出た口座名のうち、スマートレシート・Amazonの連携口座を割り出す。
 *
 * 1. 口座名の対応があれば、その `target` が `INFO_SOURCE`（取引にしない情報源）の名前だけを候補にする
 *    （人が「口座」として対応させた名前からは取り込まない）
 * 2. 対応が無ければ `guessAccount(name).target === "INFO_SOURCE"` の名前を候補にする
 * 3. 候補のうち、口座名からスマートレシート・Amazonのどちらか決まるものだけを返す
 *    （「楽天市場」「反映待ち」も情報源だが、ここで取り込む連携ではない）
 *
 * 同じ連携の口座名が複数あっても（「スマートレシート」と「スマートレシート (旧)」など）すべて返す。
 * 明細は明細id単位で重複を除き、まとめるキーにも口座名を含めるので、取り違えは起きない。
 */
export function resolveLinkedSourceAccounts(
    accountNames: Iterable<string>,
    mappings: readonly LinkedAccountMappingRef[] = []
): LinkedSourceAccount[] {
    const targetByName = new Map(mappings.map((mapping) => [mapping.externalName.trim(), mapping.target]))
    const resolved: LinkedSourceAccount[] = []
    const seen = new Set<string>()

    for (const raw of accountNames) {
        const name = raw.trim()
        if (!name || seen.has(name)) continue
        seen.add(name)

        const target = targetByName.get(name) ?? guessAccount(name).target
        if (target !== "INFO_SOURCE") continue
        const source = linkedSourceOfName(name)
        if (source === null) continue
        resolved.push({ source, accountName: name })
    }

    return resolved.sort(
        (a, b) =>
            LINKED_RECEIPT_SOURCES.indexOf(a.source) - LINKED_RECEIPT_SOURCES.indexOf(b.source) ||
            a.accountName.localeCompare(b.accountName, "ja")
    )
}

/** 口座名 → 由来 の逆引き。明細のふるい分けに使う。 */
export function buildSourceByAccountName(
    accounts: readonly LinkedSourceAccount[]
): Map<string, LinkedReceiptSource> {
    return new Map(accounts.map((account) => [account.accountName, account.source]))
}
