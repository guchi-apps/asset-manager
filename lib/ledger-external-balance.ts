/**
 * 明細が届く口座の残高を、Zaimの現在の残高で出す（Issue #881）。DBに触らない純粋な関数。
 * 読み込みは `lib/ledger-external-balance-service.ts`。
 *
 * 家計簿の計算の残高（`lib/ledger-balance.ts`）は、遅れて届く明細や取り込み漏れですぐずれる。
 * カード・銀行のようにZaimが金融機関から残高を取っている口座は、その値をそのまま口座の残高として出し、
 * 家計簿の計算は差を見るためだけに並べる。残高調整の取引は作らない（収支・履歴に触らない）。
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
