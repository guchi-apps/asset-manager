"use server"

import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { isZaimAllowedEmail } from "@/lib/zaim-access"
import { fetchZaimSnapshotFromAide, ZaimAideError } from "@/lib/zaim-aide"
import { resolveZaimEntries, type ZaimResolvedEntry } from "@/lib/zaim-match"
import type { ZaimFreshness } from "@/lib/zaim-freshness"
import { syncZaimValuations } from "@/lib/zaim-sync"

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

function toErrorResult(error: unknown): ZaimFetchResult {
    console.error("Zaim fetch failed:", error)

    // AIDE側の状態（未設定・鍵違い・接続不可）は原因が分かれば直せるため、そのまま画面へ出す。
    if (error instanceof ZaimAideError) {
        return { success: false, error: `Zaimの取得元（AIDE）から受け取れません: ${error.message}` }
    }
    return { success: false, error: "Zaimからの取得に失敗しました" }
}

/**
 * Zaimから評価額を取得する。DBへは保存せず、画面の入力欄へ反映するための値を返す。
 * 保存は利用者が内容を確認したうえで既存の保存処理から行う。
 */
export async function fetchZaimValuationsAction(): Promise<ZaimFetchResult> {
    const auth = await authorizeZaimUser()
    if ("error" in auth) return { success: false, error: auth.error }

    try {
        const result = await syncZaimValuations(auth.userId, { dryRun: true })
        return {
            success: true,
            entries: result.entries,
            unmatched: result.unmatched,
            freshness: result.freshness,
        }
    } catch (error) {
        return toErrorResult(error)
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
        const settingById = new Map(settings.map((setting) => [setting.id, setting]))

        const targets = categories
            .filter((category) => {
                const setting = settingById.get(category.id)
                return setting ? setting.isValuationTarget : false
            })
            .map((category) => ({
                id: category.id,
                name: category.name,
                valuationAlias:
                    settingById.get(category.id)?.valuationAlias ?? category.valuationAlias,
            }))

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
