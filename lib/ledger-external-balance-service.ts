/**
 * 明細が届く口座の、Zaimの現在の残高を読む（Issue #881）。突き合わせの決まりは `lib/ledger-external-balance.ts`。
 *
 * AIDEのキャッシュ（`/api/money/summary`）を読むだけで、Zaimへは取りに行かない・書き込まない。
 * 画面を開いたあとに別に呼ぶので、AIDEが遅くても家計簿の表示は待たせない。
 */
import { prisma } from "@/lib/prisma"
import { describeZaimAideError, fetchZaimSnapshotFromAide, ZaimAideError, type ZaimPoint } from "@/lib/zaim-aide"
import { ZAIM_PROVIDER } from "@/lib/ledger-sources/mapping"
import { matchExternalBalances, type ExternalBalance } from "@/lib/ledger-external-balance"
import { fillMissingPoints, pointsToRecord, type PointSettingView } from "@/lib/ledger-points"

export interface ExternalBalancesView {
    /** AIDEがZaimを巡回した時刻（ISO8601） */
    fetchedAt: string | null
    balances: ExternalBalance[]
    /** Zaimのポイント・マイル（#1533）。`includePoints` を付けなければ常に空 */
    points: ZaimPoint[]
    /** Zaim由来のポイントごとの設定（表示名・色・非表示。キーは `zaim:<ポイント名>`。#1603） */
    pointSettings: Record<string, PointSettingView>
}

/**
 * `includePoints` は口座タブの表示だけが付ける。付けると明細が届く口座が無くてもAIDEを読む。
 * 残高合わせ（`reconcileExternalBalancesAction`）は付けないので、ポイントのためにAIDEへ依存が増えない。
 */
export async function loadExternalBalances(userId: string, options: { includePoints?: boolean } = {}): Promise<ExternalBalancesView> {
    const [accounts, mappings] = await Promise.all([
        prisma.ledgerAccount.findMany({ where: { userId }, select: { id: true, name: true, hasStatementFeed: true } }),
        prisma.ledgerSourceAccountMapping.findMany({
            where: { userId, provider: ZAIM_PROVIDER, target: "ACCOUNT", accountId: { not: null } },
            select: { externalName: true, accountId: true },
        }),
    ])
    const includePoints = options.includePoints === true
    if (!includePoints && !accounts.some((a) => a.hasStatementFeed)) return { fetchedAt: null, balances: [], points: [], pointSettings: {} }

    let snapshot
    try {
        snapshot = await fetchZaimSnapshotFromAide()
    } catch (error) {
        if (error instanceof ZaimAideError) throw new Error(describeZaimAideError(error.reason))
        throw error
    }
    const matched = accounts.some((a) => a.hasStatementFeed)
        ? matchExternalBalances(accounts, mappings, snapshot.snapshot.balances)
        : new Map<number, ExternalBalance>()
    if (!includePoints) return { fetchedAt: snapshot.fetchedAt, balances: [...matched.values()], points: [], pointSettings: {} }

    // Zaimが返さなくなった（0ptで一覧から外れた）ポイントを0ptで残す。記録は残高が変わったときだけ書く（#1603）
    const settings = await prisma.ledgerPointSetting.findMany({
        where: { userId, itemKey: { startsWith: "zaim:" } },
        select: { itemKey: true, displayName: true, color: true, hidden: true, lastSeenAmount: true },
    })
    const pointsPresent = snapshot.snapshot.pointsPresent === true
    const points = fillMissingPoints(snapshot.snapshot.points, settings, pointsPresent)
    if (pointsPresent) {
        for (const r of pointsToRecord(snapshot.snapshot.points, settings)) {
            await prisma.ledgerPointSetting.upsert({
                where: { userId_itemKey: { userId, itemKey: r.itemKey } },
                create: { userId, itemKey: r.itemKey, lastSeenAmount: r.amount },
                update: { lastSeenAmount: r.amount },
            })
        }
    }
    return {
        fetchedAt: snapshot.fetchedAt,
        balances: [...matched.values()],
        points,
        pointSettings: Object.fromEntries(settings.map((s) => [s.itemKey, { displayName: s.displayName, color: s.color, hidden: s.hidden }])),
    }
}
