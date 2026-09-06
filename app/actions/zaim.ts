"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { isZaimAllowedEmail } from "@/lib/zaim-access"
import { fetchZaimSnapshotFromAide, ZaimAideError } from "@/lib/zaim-aide"
import {
    buildZaimAliasTargets,
    resolveZaimEntries,
    splitAliases,
    toMatchKey,
    type ZaimResolvedEntry,
} from "@/lib/zaim-match"
import {
    describeZaimFreshness,
    resolveEntryRecordDayKey,
    type ZaimFreshness,
} from "@/lib/zaim-freshness"
import { getCalendarDayKey, parseValuationDateInput } from "@/lib/valuation-day"
import { planAssetSnapshotWrite } from "@/lib/valuation-change"
import type { AssetKind } from "@/lib/asset-breakdown"
import { syncZaimValuations } from "@/lib/zaim-sync"
import { buildZaimFetchItems } from "@/lib/zaim-sync-report"
import { recordDataFetchRun } from "@/lib/data-fetch-log"
import { revalidateUserDashboard } from "@/lib/dashboard-cache"

export type ZaimFetchResult =
    | {
          success: true
          /** 対応付けできた項目。評価額入力欄へ反映する。 */
          entries: ZaimResolvedEntry[]
          /** どのZaim表示名にも対応付かなかった項目 */
          unmatched: string[]
          /** いつ巡回した結果か。AIDEは日次のため、押した瞬間の値ではない。 */
          freshness: ZaimFreshness
      }
    | { success: false; error: string }

/** 手動取り込みの結果。画面はこの件数をそのままトーストへ出す。 */
export type ZaimSyncActionResult =
    | {
          success: true
          /** 保存できた項目数 */
          updated: number
          /** 保存を見送った項目数（既存値・鮮度・±50%の異常値など） */
          skipped: number
          /** どのカテゴリにも対応付かなかったZaim側の項目数 */
          unmatched: number
          /** AIDEが巡回した日（JSTの `YYYY-MM-DD`） */
          recordDayKey: string
          freshness: ZaimFreshness
      }
    | { success: false; error: string }

/** 保存前の表示設定。テスト読み込みで編集中の値を評価するために受け取る。 */
export interface ZaimTestSetting {
    id: number
    valuationAlias: string | null
    isValuationTarget: boolean
}

const NOT_ALLOWED_ERROR =
    "この操作は許可されていません。Zaim連携は管理者のアカウントでのみ利用できます。"

/**
 * Zaim操作の認可。AIDEが持つZaimのログイン状態はサーバー上に1つしかないため、
 * 許可したユーザー以外が他人のZaimデータを取得できないようにする。
 */
async function authorizeZaimUser(): Promise<{ userId: string } | { error: string }> {
    const user = await getCurrentUser()
    if (!user) return { error: "ログインが必要です" }
    if (!isZaimAllowedEmail(user.email)) return { error: NOT_ALLOWED_ERROR }
    return { userId: user.id }
}

/** 画面でZaim連携の操作を表示してよいかを返す。 */
export async function canUseZaimAction(): Promise<boolean> {
    const user = await getCurrentUser()
    return isZaimAllowedEmail(user?.email)
}

/** AIDE側の状態（未設定・鍵違い・接続不可）は原因が分かれば直せるため、そのまま画面へ出す。 */
function describeZaimError(error: unknown): string {
    if (error instanceof ZaimAideError) {
        return `Zaimの取得元（AIDE）から受け取れません: ${error.message}`
    }
    return "Zaimからの取得に失敗しました"
}

function toErrorResult(error: unknown): ZaimFetchResult {
    console.error("Zaim fetch failed:", error)
    return { success: false, error: describeZaimError(error) }
}

/**
 * 画面（データ取得状況）からの手動取り込み。**評価額を保存する。**
 *
 * 毎晩23:50の定期実行が落ちた日・AIDEの巡回が遅れた日に、その場で取り込み直すための口。
 * 結果は定期実行と同じ形で `DataFetchRun` へ残すため、画面の実行履歴から追える
 * （`trigger` は `MANUAL`。最新カードは `SCHEDULED` しか拾わないので、手動ぶんが
 * 「今日の定期実行」として出てしまうことはない）。
 *
 * 定期実行との違いは次の2点で、いずれも**結果を見ている人がいる**ことによる。
 *
 * - `overwriteExisting`: その日の値がすでにあっても上書きする。定期実行は当日ぶんに限って
 *   上書きするが、手動実行は「入っている値がおかしいので取り直す」ために押される
 * - `requireFresh`: 付けない。巡回が古いことは画面の鮮度表示で分かるうえ、
 *   古い残高そのものは `detectStaleSource` が項目ごとに弾く
 */
export async function runZaimSyncAction(): Promise<ZaimSyncActionResult> {
    const auth = await authorizeZaimUser()
    if ("error" in auth) return { success: false, error: auth.error }

    const startedAt = new Date()
    try {
        const result = await syncZaimValuations(auth.userId, {
            overwriteExisting: true,
            detectLargeDiff: true,
            detectStaleSource: true,
        })

        await recordDataFetchRun({
            userId: auth.userId,
            job: "ZAIM_VALUATION",
            startedAt,
            trigger: "MANUAL",
            targetDay: result.recordDayKey,
            sourceLabel: describeZaimFreshness(result.freshness).label,
            items: buildZaimFetchItems(result),
        })

        // 評価額が変わるため、この画面だけでなくダッシュボード・資産の一覧も作り直す。
        // 定期実行（`scripts/zaim-sync.ts`）は別プロセスでキャッシュを持たないが、
        // ここはNext.jsのサーバー上なので、タグ付きのダッシュボードキャッシュも捨てる。
        revalidatePath("/data-fetch")
        revalidatePath("/")
        revalidatePath("/assets")
        revalidateUserDashboard(auth.userId)

        return {
            success: true,
            updated: result.updated,
            skipped: result.skipped,
            unmatched: result.unmatched.length,
            recordDayKey: result.recordDayKey,
            freshness: result.freshness,
        }
    } catch (error) {
        console.error("Zaim manual sync failed:", error)
        await recordDataFetchRun({
            userId: auth.userId,
            job: "ZAIM_VALUATION",
            startedAt,
            trigger: "MANUAL",
            message: "手動のZaim取り込みに失敗しました",
            items: [
                {
                    outcome: "FAILED",
                    label: "Zaim取り込み（手動）",
                    reason: "fetchFailed",
                    detail:
                        error instanceof Error
                            ? error.message.replace(/\s+/g, " ").trim().slice(0, 300)
                            : null,
                },
            ],
        })
        return { success: false, error: describeZaimError(error) }
    }
}

/**
 * 表示設定のテスト読み込み。保存していない編集中のZaim表示名で対応付けを試し、
 * どの項目がどのカテゴリへいくら反映されるかを返す。DBへは一切書き込まない。
 */
export async function testZaimFetchAction(
    settings: ZaimTestSetting[]
): Promise<ZaimFetchResult> {
    const auth = await authorizeZaimUser()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        // 名称は必ずDBから取り、クライアントからは対象IDとZaim表示名だけを受け取る。
        const categories = await prisma.category.findMany({
            where: { userId: auth.userId },
            select: { id: true, name: true, valuationAlias: true },
        })
        // 並び順は `settings` のまま保つ（同名行の割り当て順を画面の並びで決めるため）。
        const targets = buildZaimAliasTargets(settings, categories)

        const { snapshot, ...freshness } = await fetchZaimSnapshotFromAide()
        const { entries, unmatched } = resolveZaimEntries(targets, snapshot)
        return { success: true, entries, unmatched, freshness }
    } catch (error) {
        return toErrorResult(error)
    }
}

/**
 * 画面の表示用に、いつ巡回した結果を渡せるかだけを先に返す。
 * 取得ボタンを押す前から鮮度が分かるようにするためで、対応付けは行わない。
 */
export async function getZaimFreshnessAction(): Promise<ZaimFreshness | null> {
    if (!(await canUseZaimAction())) return null

    try {
        const { snapshot, ...freshness } = await fetchZaimSnapshotFromAide()
        void snapshot
        return freshness
    } catch (error) {
        // 鮮度の表示は付随情報にすぎない。取れなくても画面自体は開けるようにする。
        console.error("Zaim freshness fetch failed:", error)
        return null
    }
}

/**
 * Zaimの残高一覧のうち、どのアセットにも対応付いていない1件（Issue #344）。
 *
 * **残高一覧だけを対象にする。** 保有銘柄は証券口座の内訳にあたり、口座の合計と
 * 二重に数えることになるため（`matchZaimSnapshot` の「5. 残高一覧」も同じ理由で
 * 反映済みの証券口座を飛ばしている）。
 */
export interface ZaimUnregisteredBalance {
    /** `valuationAlias` にそのまま貼れる表記 */
    name: string
    amount: number
    lastUpdatedAt: string | null
    /** 金額の符号から決めた種別の初期値。マイナス残高（カード・借入）は負債にする。 */
    suggestedKind: AssetKind
}

export type ZaimUnregisteredResult =
    | { success: true; balances: ZaimUnregisteredBalance[]; freshness: ZaimFreshness }
    | { success: false; error: string }

/** 一括登録の1件。名称はZaim側の表記をそのまま使うため、クライアントからは受け取らない値がない。 */
export interface ZaimRegisterDraft {
    name: string
    kind: AssetKind
}

export type ZaimRegisterResult =
    | { success: true; created: number; skipped: string[] }
    | { success: false; error: string }

/** 新しく作るアセットの表示色。既存のカテゴリ数から順に選ぶだけで、意味は持たせない。 */
const NEW_CATEGORY_COLORS = [
    "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#14b8a6",
    "#ef4444", "#6366f1", "#84cc16", "#ec4899", "#0ea5e9",
]

/**
 * どのアセットにも対応付いていないZaimの残高を返す。
 *
 * 「対応付いていない」の判定には**すべてのカテゴリ**の `valuationAlias` を使う
 * （`isValuationTarget` が false のカテゴリも含める）。自動取得の対象から外しただけの
 * アセットを未登録として出すと、同じ口座をもう1件作ってしまうため。
 * 名称がカテゴリ名と一致するものも、すでに手で作られているとみなして外す。
 */
export async function getUnregisteredZaimBalancesAction(): Promise<ZaimUnregisteredResult> {
    const auth = await authorizeZaimUser()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const categories = await prisma.category.findMany({
            where: { userId: auth.userId },
            select: { id: true, name: true, valuationAlias: true },
        })

        const { snapshot, ...freshness } = await fetchZaimSnapshotFromAide()
        const { unmatched } = resolveZaimEntries(categories, snapshot)
        const unmatchedNames = new Set(unmatched)
        const existingNameKeys = new Set(categories.map((category) => toMatchKey(category.name)))

        const balances = snapshot.balances
            .filter((balance) => unmatchedNames.has(balance.name))
            .filter((balance) => !existingNameKeys.has(toMatchKey(balance.name)))
            .map((balance) => ({
                name: balance.name,
                amount: balance.amount,
                lastUpdatedAt: balance.lastUpdatedAt,
                suggestedKind: (balance.amount < 0 ? "liability" : "cash") as AssetKind,
            }))

        return { success: true, balances, freshness }
    } catch (error) {
        console.error("Zaim unregistered balances fetch failed:", error)
        return { success: false, error: describeZaimError(error) }
    }
}

/**
 * 選んだZaimの残高をアセットとして作る（Issue #344）。
 *
 * 名称をそのまま `valuationAlias` に入れるので、翌日以降は定期実行が評価額を更新する。
 * いまの残高も評価額として記録するが、記録日は**その行の最終更新が属する日**にする
 * （`resolveEntryRecordDayKey`。連携が止まっている口座は巡回日へ落ちる）。
 * 金額はZaimの符号のまま保存する——負債はマイナスで持つ（`lib/asset-breakdown.ts`）。
 */
export async function registerZaimBalancesAction(
    drafts: ZaimRegisterDraft[]
): Promise<ZaimRegisterResult> {
    const auth = await authorizeZaimUser()
    if ("error" in auth) return { success: false, error: auth.error }
    if (drafts.length === 0) return { success: true, created: 0, skipped: [] }

    try {
        const { snapshot, ...freshness } = await fetchZaimSnapshotFromAide()
        const amountByName = new Map(snapshot.balances.map((b) => [b.name, b] as const))
        const crawlDayKey = getCalendarDayKey(
            freshness.fetchedAt ? new Date(freshness.fetchedAt) : new Date()
        )

        const existing = await prisma.category.findMany({
            where: { userId: auth.userId },
            select: { name: true, valuationAlias: true, order: true, valuationOrder: true },
        })
        const taken = new Set<string>()
        for (const category of existing) {
            taken.add(toMatchKey(category.name))
            for (const aliasKey of splitAliases(category.valuationAlias)) taken.add(aliasKey)
        }

        let nextOrder = existing.reduce((max, c) => Math.max(max, c.order ?? 0), -1) + 1
        let nextValuationOrder =
            existing.reduce((max, c) => Math.max(max, c.valuationOrder ?? 0), -1) + 1
        let colorIndex = existing.length

        const skipped: string[] = []
        let created = 0

        for (const draft of drafts) {
            const name = draft.name.trim()
            const balance = amountByName.get(name)
            const nameKey = toMatchKey(name)

            if (!name || name.length > 50 || !balance || taken.has(nameKey)) {
                skipped.push(draft.name)
                continue
            }
            taken.add(nameKey)

            const category = await prisma.category.create({
                data: {
                    userId: auth.userId,
                    name,
                    color: NEW_CATEGORY_COLORS[colorIndex++ % NEW_CATEGORY_COLORS.length],
                    order: nextOrder++,
                    valuationOrder: nextValuationOrder++,
                    isValuationTarget: true,
                    valuationAlias: name,
                    isCash: draft.kind === "cash",
                    isLiability: draft.kind === "liability",
                },
            })

            const dayKey = resolveEntryRecordDayKey(balance.lastUpdatedAt, crawlDayKey)
            const planned = await planAssetSnapshotWrite({
                categoryId: category.id,
                userId: auth.userId,
                date: parseValuationDateInput(dayKey),
                value: balance.amount,
            })
            // 作ったばかりのカテゴリにその日の評価額がある状態はありえないが、
            // 万一そうなっても上書きの確認を出す相手がいないため、その1件だけ諦める。
            if ("operations" in planned) await prisma.$transaction(planned.operations)

            created++
        }

        revalidatePath("/data-fetch")
        revalidatePath("/")
        revalidatePath("/assets")
        revalidateUserDashboard(auth.userId)

        return { success: true, created, skipped }
    } catch (error) {
        console.error("Zaim bulk register failed:", error)
        return { success: false, error: describeZaimError(error) }
    }
}
