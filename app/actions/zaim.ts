"use server"

import { prisma } from "@/lib/prisma"
import { getCurrentUserId } from "@/lib/auth"
import { scrapeZaimSnapshot } from "@/lib/zaim-scraper"
import { resolveZaimEntries, type ZaimResolvedEntry } from "@/lib/zaim-match"
import { syncZaimValuations } from "@/lib/zaim-sync"

export type ZaimFetchResult =
    | {
          success: true
          /** 対応付けできた項目。評価額入力欄へ反映する。 */
          entries: ZaimResolvedEntry[]
          /** どのZaim表示名にも対応付かなかった項目 */
          unmatched: string[]
      }
    | { success: false; error: string; sessionExpired?: boolean }

/** 保存前の表示設定。テスト読み込みで編集中の値を評価するために受け取る。 */
export interface ZaimTestSetting {
    id: number
    valuationAlias: string | null
    isValuationTarget: boolean
}

function toErrorResult(error: unknown): ZaimFetchResult {
    console.error("Zaim fetch failed:", error)
    const message = error instanceof Error ? error.message : String(error)

    if (message.includes("session expired")) {
        return {
            success: false,
            sessionExpired: true,
            error: "Zaimのログイン状態が切れています。再ログインが必要です。",
        }
    }
    return { success: false, error: "Zaimからの取得に失敗しました" }
}

/**
 * Zaimから評価額を取得する。DBへは保存せず、画面の入力欄へ反映するための値を返す。
 * 保存は利用者が内容を確認したうえで既存の保存処理から行う。
 */
export async function fetchZaimValuationsAction(): Promise<ZaimFetchResult> {
    const userId = await getCurrentUserId()
    if (!userId) {
        return { success: false, error: "ログインが必要です" }
    }

    try {
        const result = await syncZaimValuations(userId, { dryRun: true })
        return { success: true, entries: result.entries, unmatched: result.unmatched }
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
    const userId = await getCurrentUserId()
    if (!userId) {
        return { success: false, error: "ログインが必要です" }
    }

    try {
        // 名称は必ずDBから取り、クライアントからは対象IDとZaim表示名だけを受け取る。
        const categories = await prisma.category.findMany({
            where: { userId },
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

        const snapshot = await scrapeZaimSnapshot()
        const { entries, unmatched } = resolveZaimEntries(targets, snapshot)
        return { success: true, entries, unmatched }
    } catch (error) {
        return toErrorResult(error)
    }
}
