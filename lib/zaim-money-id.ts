/**
 * Zaimの明細id（money id）をDBの `BigInt` とアプリの `number` の間で受け渡す（Issue #281）。
 *
 * Zaimのmoney idは2026-08時点で約 1.02e10 に達しており、MySQLのINT（上限 2,147,483,647）には
 * 収まらない。保存先の列はすべてBIGINTにしてあるため、Prismaは読み出しをJSの `bigint` で返す。
 *
 * ただしアプリ側で `bigint` を持ち回すと、サーバーアクションの戻り値やJSONへ載せられない。
 * 値は `Number.MAX_SAFE_INTEGER`（約 9.0e15）に対して5桁以上の余裕があるので、DBから出た
 * ところで `number` へ戻す。書き込みはPrismaが `number` をそのまま受け取るため変換は要らない。
 */

/** DBから読んだmoney idを `number` にする。 */
export function toMoneyIdNumber(value: bigint): number {
    return Number(value)
}

/** null を許す列（レシートの `zaimMoneyId` など）用。 */
export function toMoneyIdNumberOrNull(value: bigint | null): number | null {
    return value === null ? null : Number(value)
}
