/**
 * 明細ラボから移した画面（給与・賞与・ふるさと納税・税務確認）を公開してよいかの判定（Issue #736）。
 *
 * 既存データの移行（`npm run meisai:migrate` の apply/verify）と、旧アプリの読み取り専用化・旧URL転送が
 * 済む前にこれらの画面を開けると、新しいテーブルが空のまま過去の記録が見えず、新旧どちらにも入力できる
 * 状態になって更新先が割れる。切替が終わるまでは、導線・画面・書き込みをすべて閉じておく。
 *
 * 切替完了後に本番の環境変数 `MEISAI_LAB_CUTOVER=1` を設定すると開く。未設定・それ以外の値は閉じたまま。
 * 手順は `docs/meisai-lab-migration.md`。
 */

import type { MainMenuKey } from "@/lib/nav-sections"

type CutoverEnv = Record<string, string | undefined>

/** 明細ラボから移した画面のパス（API含む）。`/salaries/settings` も `/salaries` 配下に含まれる */
const MEISAI_PATH_PREFIXES = ["/salaries", "/bonuses", "/furusato", "/tax", "/api/salaries"]

/** 切替が完了して公開してよいか */
export function isMeisaiCutoverComplete(env: CutoverEnv = process.env): boolean {
    return env.MEISAI_LAB_CUTOVER === "1"
}

/** 切替完了まで閉じておく画面・APIのパスか */
export function isMeisaiGatedPath(pathname: string): boolean {
    return MEISAI_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"))
}

/** サイドバーから外すメインメニュー */
export function hiddenMainMenus(env: CutoverEnv = process.env): MainMenuKey[] {
    return isMeisaiCutoverComplete(env) ? [] : ["payroll"]
}

/** サーバーアクション・APIの先頭で使う。閉じている間のエラーメッセージ（開いていれば null） */
export function meisaiClosedMessage(env: CutoverEnv = process.env): string | null {
    return isMeisaiCutoverComplete(env) ? null : "この機能は明細ラボからの切替が完了するまで利用できません"
}
