/**
 * 明細が届く口座の残高を、Zaimの現在の残高で出す（Issue #881）。DBに触らない純粋な関数。
 * 読み込みは `lib/ledger-external-balance-service.ts`。
 *
 * 家計簿の計算の残高（`lib/ledger-balance.ts`）は、遅れて届く明細や取り込み漏れですぐずれる。
 * カード・銀行のようにZaimが金融機関から残高を取っている口座は、その値をそのまま口座の残高として出し、
 * 家計簿の計算は差を見るためだけに並べる。表示のために残高調整の取引は作らない（収支・履歴に触らない）。
 * 差を消したいときは、利用者が「Zaimの残高に合わせる」を押したときだけ直す
 * （`planExternalReconciliation`・`lib/ledger-service.ts` の `reconcileAccountBalances`）。
 * 差の多くは、取り込みを始めた日（初期残高の基準日）より前の残高が初期残高に入っていないことによるので、
 * 既定では差を初期残高へ足す。今日の残高調整の取引として残すこともできる。
 */

export interface ExternalBalanceAccount {
    id: number
    name: string
    hasStatementFeed: boolean
}

export interface ExternalBalanceMapping {
    /** Zaimでの口座名（取り込みの「口座名の対応」） */
    externalName: string
    accountId: number | null
}

export interface ExternalBalanceSource {
    name: string
    amount: number
    /** Zaimが金融機関から残高を取得した時刻（ISO8601）。連携していない口座は null */
    lastUpdatedAt: string | null
}

export interface ExternalBalance {
    accountId: number
    /** 使ったZaimの口座名 */
    zaimName: string
    amount: number
    lastUpdatedAt: string | null
}

/**
 * 口座ごとにZaimの残高を1つ選ぶ。
 *
 * - 対象は明細が届く口座だけ（現金・PayPayは家計簿の計算を正とする）
 * - 候補の名前は「口座名の対応」でその口座に対応付けたZaimの口座名と、口座そのものの名前
 * - 候補に当たる残高がちょうど1つのときだけ使う。2つ以上なら決められないので使わない
 * - 1つの残高が2つ以上の口座の候補になったときも、どれに付けるか決められないので使わない
 */
export function matchExternalBalances(
    accounts: readonly ExternalBalanceAccount[],
    mappings: readonly ExternalBalanceMapping[],
    balances: readonly ExternalBalanceSource[]
): Map<number, ExternalBalance> {
    const byName = new Map<string, ExternalBalanceSource[]>()
    for (const b of balances) {
        const key = b.name.trim()
        byName.set(key, [...(byName.get(key) ?? []), b])
    }

    const picked = new Map<number, ExternalBalanceSource>()
    for (const account of accounts) {
        if (!account.hasStatementFeed) continue
        const names = new Set([account.name.trim(), ...mappings.filter((m) => m.accountId === account.id).map((m) => m.externalName.trim())])
        const hits = [...names].flatMap((n) => byName.get(n) ?? [])
        if (hits.length === 1) picked.set(account.id, hits[0])
    }

    const claims = new Map<ExternalBalanceSource, number>()
    for (const source of picked.values()) claims.set(source, (claims.get(source) ?? 0) + 1)

    const result = new Map<number, ExternalBalance>()
    for (const [accountId, source] of picked) {
        if ((claims.get(source) ?? 0) > 1) continue
        result.set(accountId, { accountId, zaimName: source.name, amount: source.amount, lastUpdatedAt: source.lastUpdatedAt })
    }
    return result
}

/** これより古い取得時刻は、画面で目立たせる */
export const EXTERNAL_BALANCE_STALE_DAYS = 3

/** Zaimが金融機関から取った時刻が古いか。時刻が無い（連携していない）ものは古いとはしない */
export function isExternalBalanceStale(lastUpdatedAt: string | null, now: Date, staleDays = EXTERNAL_BALANCE_STALE_DAYS): boolean {
    if (!lastUpdatedAt) return false
    const at = Date.parse(lastUpdatedAt)
    if (Number.isNaN(at)) return false
    return now.getTime() - at >= staleDays * 24 * 60 * 60 * 1000
}

export interface ReconcileAccount {
    id: number
    name: string
    /** 家計簿の計算の残高（全期間の取引を積んだもの。画面の「家計簿の計算」と同じ） */
    balance: number
    openingBalance: number
    /** 初期残高の基準日（JSTの `YYYY-MM-DD`）。null なら全取引を積む */
    openingDate: string | null
}

export interface ReconcileItem {
    accountId: number
    name: string
    /** 家計簿の計算の残高 */
    current: number
    /** Zaimの残高（合わせる先） */
    target: number
    /** target - current。正なら残高調整で増やし、負なら減らす */
    diff: number
    openingBalance: number
    openingDate: string | null
    /** 差を初期残高へ足したときの初期残高 */
    newOpeningBalance: number
}

/** 差の直し方。`opening` は初期残高へ足す、`adjustment` は今日の残高調整の取引として残す */
export type ReconcileMode = "opening" | "adjustment"

export function parseReconcileMode(value: unknown): ReconcileMode {
    return value === "adjustment" ? "adjustment" : "opening"
}

/**
 * Zaimの残高と家計簿の計算に差がある口座と、その差。
 * Zaimの残高が無い口座・差が0の口座は含めない。並びは `accounts` の順。
 */
export function planExternalReconciliation(
    accounts: readonly ReconcileAccount[],
    external: ReadonlyMap<number, Pick<ExternalBalance, "amount">>
): ReconcileItem[] {
    const items: ReconcileItem[] = []
    for (const account of accounts) {
        const ext = external.get(account.id)
        if (!ext) continue
        const diff = ext.amount - account.balance
        if (diff === 0) continue
        items.push({
            accountId: account.id,
            name: account.name,
            current: account.balance,
            target: ext.amount,
            diff,
            openingBalance: account.openingBalance,
            openingDate: account.openingDate,
            newOpeningBalance: account.openingBalance + diff,
        })
    }
    return items
}
