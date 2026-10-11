/**
 * メインメニュー（7項目）と、その配下のページの対応表（Issue #692）。
 * 「給与」は明細ラボの給与・賞与を移管したときに足した（Issue #714）。ふるさと納税・年次税務も
 * メニューを増やさず、給与の共通タブとして足す（親Issue #713 の配置方針）。
 * サイドバーの選択状態・共通タブ・ページ見出しがここを参照する。
 */

export type MainMenuKey = "home" | "assets" | "receipts" | "subscriptions" | "payroll" | "analysis" | "settings"

export interface SectionTab {
    title: string
    url: string
}

export const MAIN_MENU: { key: MainMenuKey; title: string; url: string }[] = [
    { key: "home", title: "ホーム", url: "/" },
    { key: "assets", title: "資産", url: "/assets" },
    { key: "receipts", title: "家計簿連携", url: "/receipts" },
    { key: "subscriptions", title: "サブスク", url: "/subscriptions" },
    { key: "payroll", title: "給与", url: "/salaries" },
    // 分析の初期表示は月次推移
    { key: "analysis", title: "分析", url: "/monthly" },
    { key: "settings", title: "設定", url: "/settings" },
]

/** 分析の共通タブ。先頭が初期表示 */
export const ANALYSIS_TABS: SectionTab[] = [
    { title: "月次推移", url: "/monthly" },
    { title: "基準日比較", url: "/base-date" },
    { title: "リバランス", url: "/rebalance" },
    { title: "指数", url: "/indices" },
]

/** 給与の共通タブ（Issue #714）。先頭が初期表示 */
export const PAYROLL_TABS: SectionTab[] = [
    { title: "給与", url: "/salaries" },
    { title: "賞与", url: "/bonuses" },
    { title: "項目・料率", url: "/salaries/settings" },
]

/** 設定配下の機能。`/settings` の一覧と、各画面上部の共通タブで使う */
export const SETTINGS_TABS: SectionTab[] = [
    { title: "プロフィール", url: "/profile" },
    { title: "データ連携", url: "/data-fetch" },
    { title: "データ管理", url: "/data-management" },
    { title: "各種設定", url: "/settings/general" },
]

function matches(pathname: string, url: string): boolean {
    return pathname === url || pathname.startsWith(url + "/")
}

/** パスが属するメインメニュー。どれにも属さなければ null */
export function resolveMainMenu(pathname: string): MainMenuKey | null {
    if (pathname === "/") return "home"
    if (matches(pathname, "/assets")) return "assets"
    if (matches(pathname, "/receipts")) return "receipts"
    if (matches(pathname, "/subscriptions")) return "subscriptions"
    if (PAYROLL_TABS.some((tab) => matches(pathname, tab.url))) return "payroll"
    if (ANALYSIS_TABS.some((tab) => matches(pathname, tab.url))) return "analysis"
    if (matches(pathname, "/settings") || SETTINGS_TABS.some((tab) => matches(pathname, tab.url))) {
        return "settings"
    }
    return null
}

/** 画面上部に共通タブを出す区分。出さないページは null */
export function resolveSectionTabs(pathname: string): SectionTab[] | null {
    const menu = resolveMainMenu(pathname)
    if (menu === "analysis") return ANALYSIS_TABS
    if (menu === "payroll") return PAYROLL_TABS
    // `/settings` 本体は一覧画面なのでタブは出さない
    if (menu === "settings" && pathname !== "/settings") return SETTINGS_TABS
    return null
}

/**
 * タブの選択状態。`/settings/general` と `/settings`、`/salaries/settings` と `/salaries` の
 * 前方一致が重ならないよう長いURLを優先する
 */
export function resolveActiveTab(pathname: string, tabs: SectionTab[]): string | null {
    return (
        tabs
            .filter((tab) => matches(pathname, tab.url))
            .sort((a, b) => b.url.length - a.url.length)[0]?.url ?? null
    )
}
