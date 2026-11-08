/**
 * AIDEの家計簿明細一覧のETagを覚える（Issue #1098）。
 *
 * 定期実行は前回成功したときのETagを `If-None-Match` で送り、304（AIDEの巡回が変わっていない）なら
 * 家計簿の取り込みを見送る。ただし取り込みの結果はAIDEの応答だけで決まらない（口座・カテゴリの対応と
 * 取り込み開始日にも依存する）ので、それらを変えたら `invalidateLedgerSourceEtag` で破棄する。
 * 破棄の取りこぼしに備え、保存から24時間たったETagは使わない（1日1回は必ず全件を取る）。
 */
import { prisma } from "@/lib/prisma"

/** ETagを破棄する更新内容。`$transaction([...])` の配列に `prisma.user.updateMany` として並べるときにも使う */
export const LEDGER_ETAG_CLEARED = { ledgerSourceEtag: null, ledgerSourceEtagAt: null } as const

export const LEDGER_ETAG_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** 保存済みのETagを使ってよいか。**純粋関数。** */
export function isEtagUsable(etag: string | null, savedAt: Date | null, now: Date): boolean {
    if (!etag || !savedAt) return false
    const age = now.getTime() - savedAt.getTime()
    return age >= 0 && age < LEDGER_ETAG_MAX_AGE_MS
}

/** 送ってよいETag。無い・古いときは null（全件を取る） */
export async function loadUsableLedgerEtag(userId: string, now: Date = new Date()): Promise<string | null> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { ledgerSourceEtag: true, ledgerSourceEtagAt: true },
    })
    if (!user) return null
    return isEtagUsable(user.ledgerSourceEtag, user.ledgerSourceEtagAt, now) ? user.ledgerSourceEtag : null
}

/** 取り込みが全部成功したときだけ呼ぶ */
export async function saveLedgerEtag(userId: string, etag: string, now: Date = new Date()): Promise<void> {
    await prisma.user.update({ where: { id: userId }, data: { ledgerSourceEtag: etag, ledgerSourceEtagAt: now } })
}

type EtagClient = Pick<typeof prisma, "user">

/**
 * ETagを破棄する。次の定期実行は全件を取り直す。
 * 取り込みの結果が変わりうる書き込み（取り込み開始日・口座とカテゴリの対応・それらの元になる口座とカテゴリの削除や統合・CSV取り込み）
 * の後に呼ぶ。トランザクションの中なら `client` に `tx` を渡す。
 */
export async function invalidateLedgerSourceEtag(userId: string, client: EtagClient = prisma): Promise<void> {
    await client.user.updateMany({ where: { id: userId, ledgerSourceEtag: { not: null } }, data: LEDGER_ETAG_CLEARED })
}
