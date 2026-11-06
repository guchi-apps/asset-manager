import { Prisma } from "@prisma/client"

/**
 * 口座を指す取引を書く処理が、口座の行に共有ロックを取って存在を確かめる（#917）。
 *
 * `relationMode = "prisma"` のためDBの外部キーは無く、「口座があるか確かめる → 取引を書く」の間に口座の削除が
 * 入ると、存在しない口座を指す取引が残る。口座の削除（`deleteAccount`）は同じ行に排他ロックを取るので、
 * 書き込み側がこの共有ロックを持っている間は削除が待ち、削除が先に進んでいれば書き込み側は口座が見つからず断られる。
 * `FOR SHARE` はMariaDBが解釈できず構文エラー（1064）になるため、両方で通る `LOCK IN SHARE MODE` を使う（#927）。
 * 呼び出し側のトランザクションの中で、取引を書く前に呼ぶこと（ロックはコミットまで続く）。
 */
export async function lockAccountsForWrite(tx: Prisma.TransactionClient, userId: string, ids: (number | null | undefined)[]): Promise<void> {
    const wanted = [...new Set(ids.filter((id): id is number => id != null))].sort((a, b) => a - b)
    if (wanted.length === 0) return
    const rows = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM LedgerAccount WHERE userId = ${userId} AND id IN (${Prisma.join(wanted)}) ORDER BY id LOCK IN SHARE MODE`
    if (rows.length !== wanted.length) throw new Error("口座が見つかりません")
}

/** 口座の削除側。口座の行に排他ロックを取る（書き込み側の共有ロックが外れるまで待つ）。無ければ false */
export async function lockAccountForDelete(tx: Prisma.TransactionClient, userId: string, accountId: number): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM LedgerAccount WHERE userId = ${userId} AND id = ${accountId} FOR UPDATE`
    return rows.length === 1
}
