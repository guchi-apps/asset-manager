"use server"

import { getCurrentUserId } from "@/lib/auth"
import { syncZaimValuations, type ZaimSyncEntry } from "@/lib/zaim-sync"

export type ZaimFetchResult =
    | {
          success: true
          /** 対応付けできた項目。評価額入力欄へ反映する。 */
          entries: ZaimSyncEntry[]
          /** どのZaim表示名にも対応付かなかった項目 */
          unmatched: string[]
      }
    | { success: false; error: string; sessionExpired?: boolean }

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
}
