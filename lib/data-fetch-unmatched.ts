/**
 * Zaim自動取得の「対応付かなかった」項目を、家計簿で管理している口座とそれ以外に分ける（Issue #964）。
 * **純粋関数だけを置く**（クライアントコンポーネントからも読むため、Prismaに依存させない）。
 *
 * 「対応付かなかった」は投資に限らず「資産（評価額）のどのカテゴリにも対応付いていないZaim項目」の一覧で、
 * 銀行・電子マネー・財布・カードのように**家計簿の口座として管理している**ものまで同じ扱いで並んでいた。
 * それらは家計簿側で残高を持つため、資産のカテゴリへ対応付ける必要はない。
 *
 * 照合の規則は、家計簿の残高突き合わせ（`lib/ledger-external-balance.ts` の `matchExternalBalances`）とは**別**。
 * あちらは明細が届く口座だけを対象にし、1つの残高を2口座が取り合うときも落とすが、ここは
 * 「家計簿で扱っている名前か」を見るだけなので、明細が届かない口座（現金・PayPay）も含め、名前が一致すれば分ける。
 */

import { resolveDataFetchStatus } from "./data-fetch-view"

/** 家計簿の口座1つと、その口座に対応付けたZaimの口座名 */
export interface LedgerAccountNameRef {
    /** 家計簿の口座名 */
    name: string
    /** 取り込みの「口座名の対応」でこの口座に対応付けたZaimの口座名（`provider=zaim`・`target=ACCOUNT`） */
    zaimNames: string[]
}

export interface UnmatchedClassification<T> {
    /** 家計簿の口座として管理している項目。`ledgerAccount` は対応する家計簿の口座名 */
    ledger: { item: T; ledgerAccount: string }[]
    /** 資産にも家計簿にも無い項目。`ledgerAccount` は、証券口座の銘柄でその口座が家計簿にある場合だけ入る */
    unmatched: { item: T; ledgerAccount: string | null }[]
}

/** Zaim名 → 家計簿の口座名。同じZaim名が複数口座に当たる場合は先の口座を採る（表示用なので決められれば足りる） */
export function buildLedgerNameIndex(accounts: readonly LedgerAccountNameRef[]): Map<string, string> {
    const index = new Map<string, string>()
    for (const account of accounts) {
        for (const name of [account.name, ...account.zaimNames]) {
            const key = name.trim()
            if (key && !index.has(key)) index.set(key, account.name)
        }
    }
    return index
}

/**
 * 証券口座の銘柄は `口座名/銘柄名`（`#N` 付きもある）で記録されている。その口座名を返す。
 * `/` を含まない名前（残高一覧の行）は null。
 */
export function holdingAccountName(name: string): string | null {
    const slash = name.indexOf("/")
    if (slash <= 0) return null
    return name.slice(0, slash).trim() || null
}

/**
 * 未対応の項目を分ける。名前（前後の空白を除く）が家計簿の口座名か、その口座に対応付けたZaimの口座名と一致すれば
 * 「家計簿で管理中」。証券口座の銘柄（`口座名/銘柄名`）は、口座が家計簿にあっても銘柄は資産で持つものなので
 * 「未対応」に残し、口座名だけを添える。
 */
export function classifyUnmatchedItems<T>(
    items: readonly T[],
    nameOf: (item: T) => string,
    accounts: readonly LedgerAccountNameRef[]
): UnmatchedClassification<T> {
    const index = buildLedgerNameIndex(accounts)
    const result: UnmatchedClassification<T> = { ledger: [], unmatched: [] }
    for (const item of items) {
        const name = nameOf(item).trim()
        const direct = index.get(name)
        if (direct) {
            result.ledger.push({ item, ledgerAccount: direct })
            continue
        }
        const account = holdingAccountName(name)
        result.unmatched.push({ item, ledgerAccount: account ? (index.get(account) ?? null) : null })
    }
    return result
}

/** 状態の再判定に必要な、実行1回ぶんの件数。`DataFetchRunView` のうち使うものだけ */
interface RunCounts {
    job: string
    status: string
    reflected: number
    skipped: number
    unmatched: number
    failed: number
}

/**
 * 「未対応」から家計簿で管理中の口座を除いて、件数と状態を判定し直す（Issue #1093）。
 *
 * 記録した時点の状態は、家計簿の口座まで未対応に数えて「一部が未反映」にしていた。それらは家計簿側で
 * 残高を持つので資産に対応付ける必要はなく、取得は成功している。記録は書き換えず、読み出すときに直す。
 * 対象はZaim取得だけで、除く項目が無ければ元の実行をそのまま返す。取得元が古くて見送った実行（SKIPPED）は
 * 未対応と無関係なので状態を変えない。
 */
export function excludeLedgerManagedUnmatched<R extends RunCounts>(
    run: R,
    unmatchedLabels: readonly string[],
    accounts: readonly LedgerAccountNameRef[]
): R {
    if (run.job !== "ZAIM_VALUATION" || run.unmatched === 0) return run
    const managed = classifyUnmatchedItems(unmatchedLabels, (label) => label, accounts).ledger.length
    if (managed === 0) return run
    const unmatched = Math.max(0, run.unmatched - managed)
    const status =
        run.status === "SKIPPED"
            ? run.status
            : resolveDataFetchStatus({ reflected: run.reflected, skipped: run.skipped, unmatched, failed: run.failed })
    return { ...run, unmatched, status }
}
