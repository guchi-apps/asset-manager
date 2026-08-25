import { JST_TIMEZONE } from "./valuation-day"

/**
 * Zaimの取得結果が「いつのものか」を表す情報と、その表示（Issue #191）。
 *
 * 巡回はAIDEが日次で行うため、画面の「Zaimから取得」を押しても**押した瞬間の値ではない**。
 * AIDEは古いという理由で値を返さないという判断をせず、取得時刻と経過分数を必ず併せて返す
 * （AIDEの README「個人アプリ向けの読み取りAPI」）。鮮度をどう扱うかはこちら側の責務なので、
 * ここで表示用の文字列へ畳む。**純粋関数だけを置く**（クライアント側からも読むため）。
 */

export interface ZaimOnlineAccount {
    name: string
    /** Zaim側が金融機関から取得した時刻（ISO8601）。読めなければ null */
    lastUpdatedAt: string | null
}

export interface ZaimFreshness {
    /** AIDEが巡回した時刻（ISO8601）。まだ一度も巡回していなければ null */
    fetchedAt: string | null
    /** 巡回からの経過分数。まだ一度も巡回していなければ null */
    ageMinutes: number | null
    /** 巡回から24時間を超えている（AIDE側の判定をそのまま受け取る） */
    stale: boolean
    /** AIDEのキャッシュが空。まだ一度も巡回していないという状態で、エラーではない。 */
    empty: boolean
    /**
     * Zaim側の最終更新が当日でない連携口座。
     * **当日の資産額として記録するかは利用者が決める**ため、警告として見せるだけにする。
     */
    staleAccounts: ZaimOnlineAccount[]
}

const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = MINUTES_PER_HOUR * 24

/** 経過時間を「3時間前」のように畳む。分・時間・日で単位を切り替える。 */
export function formatZaimAge(ageMinutes: number): string {
    if (ageMinutes < 1) return "たった今"
    if (ageMinutes < MINUTES_PER_HOUR) return `${Math.floor(ageMinutes)}分前`
    if (ageMinutes < MINUTES_PER_DAY) return `${Math.floor(ageMinutes / MINUTES_PER_HOUR)}時間前`
    return `${Math.floor(ageMinutes / MINUTES_PER_DAY)}日前`
}

/** 取得時刻をJSTの「08/25 23:35」形式にする。年は同じ画面で見る限り不要。 */
export function formatZaimFetchedAt(fetchedAt: string): string {
    const at = new Date(fetchedAt)
    if (Number.isNaN(at.getTime())) return fetchedAt
    return at.toLocaleString("ja-JP", {
        timeZone: JST_TIMEZONE,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    })
}

/**
 * 画面のボタン横に出す一行。「いつの値なのか」を取得前から分かるようにする。
 * 取得できていない・古すぎる場合は `warn` を立て、呼び出し側で色を変える。
 */
export function describeZaimFreshness(freshness: ZaimFreshness): {
    label: string
    warn: boolean
} {
    if (freshness.empty || !freshness.fetchedAt) {
        return { label: "Zaim取得: まだ取得できていません", warn: true }
    }

    const age =
        freshness.ageMinutes === null ? "" : `（${formatZaimAge(freshness.ageMinutes)}）`
    return {
        label: `Zaim取得: ${formatZaimFetchedAt(freshness.fetchedAt)}${age}`,
        warn: freshness.stale,
    }
}

/**
 * 最終更新が当日でない連携口座の警告文。無ければ null。
 *
 * `lastUpdatedAt` はZaimが金融機関から取得した時刻で、AIDEが巡回した時刻とは別物。
 * 巡回が新しくても中身が何日も前ということがあるため、保存する前に気付けるようにする。
 */
export function describeStaleZaimAccounts(accounts: ZaimOnlineAccount[]): string | null {
    if (accounts.length === 0) return null

    const LISTED_MAX = 3
    const listed = accounts.slice(0, LISTED_MAX).map((account) => account.name)
    if (accounts.length > listed.length) listed.push(`ほか${accounts.length - listed.length}件`)
    return `Zaim側の最終更新が当日でない口座が${accounts.length}件あります（${listed.join("・")}）。保存前に金額を確認してください。`
}
