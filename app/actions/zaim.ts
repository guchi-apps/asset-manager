"use server"

import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { isZaimAllowedEmail } from "@/lib/zaim-access"
import { fetchZaimSnapshotFromAide, ZaimAideError } from "@/lib/zaim-aide"
import {
    buildZaimAliasTargets,
    resolveZaimEntries,
    type ZaimResolvedEntry,
} from "@/lib/zaim-match"
import { describeZaimFreshness, type ZaimFreshness } from "@/lib/zaim-freshness"
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
