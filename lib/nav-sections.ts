/**
 * メインメニューと、その配下のページの対応表（Issue #692）。
 * 「家計簿」は家計簿中心への再設計（親 #814）の最初の段階で足した（Issue #815）。並びの全面的な見直しは #819。
 * 「給与」は明細ラボの給与・賞与を移管したときに足した（Issue #714）。ふるさと納税・年次税務は
 * いったん給与の共通タブとして足したが、Issue #993 で新メニュー「税金」へ移した。
 * 「レシート」はメニューから外し、家計簿の配下にした（Issue #912。明細の取引・確認待ちからレシート・メールを付けられるようになったため）。
 * `/receipts` のURLと画面はそのままで、家計簿を開いているものとして扱う。
 * 「資産」は投資資産を管理する画面として「投資資産」に改め、項目の整理を共通タブへ移した（Issue #914）。
 * サイドバーの選択状態・共通タブ・ページ見出しがここを参照する。
 */

export type MainMenuKey = "home" | "ledger" | "assets" | "subscriptions" | "payroll" | "tax" | "analysis" | "settings"

export interface SectionTab {
    title: string
    url: string
}

export const MAIN_MENU: { key: MainMenuKey; title: string; url: string }[] = [
    { key: "home", title: "ホーム", url: "/" },
    // 家計簿の操作を上に寄せる（Issue #819）
    { key: "ledger", title: "家計簿", url: "/ledger" },
    // 分析の初期表示は家計（Issue #821。それまでは資産の月次推移）
    { key: "analysis", title: "分析", url: "/household" },
    { key: "assets", title: "投資資産", url: "/assets" },
    { key: "subscriptions", title: "定期払い", url: "/subscriptions" },
    { key: "payroll", title: "給与", url: "/salaries" },
    // ふるさと納税・税務確認を給与から切り出した（Issue #993）
    { key: "tax", title: "税金", url: "/furusato" },
    { key: "settings", title: "設定", url: "/settings" },
]

/** 分析の共通タブ。先頭が初期表示 */
export const ANALYSIS_TABS: SectionTab[] = [
    { title: "家計", url: "/household" },
    { title: "資産の月次推移", url: "/monthly" },
    { title: "基準日比較", url: "/base-date" },
    { title: "リバランス", url: "/rebalance" },
    { title: "指数", url: "/indices" },
]

/** 投資資産の共通タブ（Issue #914）。先頭が初期表示 */
export const ASSETS_TABS: SectionTab[] = [
    { title: "概要", url: "/assets" },
    { title: "資産の設定", url: "/assets/settings" },
    { title: "分類の設定", url: "/assets/groups" },
]

/** 給与の共通タブ（Issue #714・#715・#716）。先頭が初期表示 */
export const PAYROLL_TABS: SectionTab[] = [
    { title: "給与", url: "/salaries" },
    { title: "賞与", url: "/bonuses" },
    { title: "項目・料率", url: "/salaries/settings" },
]

/** 税金の共通タブ（Issue #993。給与から移した）。先頭が初期表示 */
export const TAX_TABS: SectionTab[] = [
    { title: "ふるさと納税", url: "/furusato" },
    { title: "税務確認", url: "/tax" },
]

/** 設定配下の機能。`/settings` の一覧と、各画面上部の共通タブで使う */
export const SETTINGS_TABS: SectionTab[] = [
    { title: "プロフィール", url: "/profile" },
    { title: "データ連携", url: "/data-fetch" },
    { title: "各種設定", url: "/settings/general" },
]

function matches(pathname: string, url: string): boolean {
    return pathname === url || pathname.startsWith(url + "/")
}

/** パスが属するメインメニュー。どれにも属さなければ null */
export function resolveMainMenu(pathname: string): MainMenuKey | null {
    if (pathname === "/") return "home"
    // レシート・メールの一覧と詳細は家計簿の配下（Issue #912）
    if (matches(pathname, "/ledger") || matches(pathname, "/receipts")) return "ledger"
    if (matches(pathname, "/assets")) return "assets"
    if (matches(pathname, "/subscriptions")) return "subscriptions"
    if (PAYROLL_TABS.some((tab) => matches(pathname, tab.url))) return "payroll"
    if (TAX_TABS.some((tab) => matches(pathname, tab.url))) return "tax"
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
    if (menu === "tax") return TAX_TABS
    // 各資産の詳細（`/assets/12`）は1件を見る画面なのでタブは出さない
    if (menu === "assets") return ASSETS_TABS.some((tab) => tab.url === pathname) ? ASSETS_TABS : null
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
