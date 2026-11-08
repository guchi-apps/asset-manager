import Foundation

/// アプリ全体で使う定数。画面・機能はすべてWeb版（正本）にあり、アプリはそれを開く殻に徹する（#1106）。
enum AppConfig {
    /// Web版のURL。開発サーバーへ向けるときもここだけを変える（ios/README.md）
    static let baseURL = URL(string: "https://asset.gucchii.com/")!

    /// 認証シートの戻り先スキーム。サーバー側の `lib/native-auth/native-app.ts` の
    /// `NATIVE_SCHEME` と揃えること（`ios/scripts/check-consistency.mjs` が照合する）。
    /// Supabase・Googleのリダイレクト先へは登録しない（サーバーの /auth/callback だけが返す）
    static let authCallbackScheme = "assetmanager"

    /// ロック画面ウィジェット（`ios/AssetManagerWidget`）のタップで開くURL（`assetmanager://ledger-add`）。
    /// 開く画面は家計簿の「手入力で追加」フォーム。ウィジェット側の `AssetManagerWidget.swift` と揃えること
    static let ledgerAddHost = "ledger-add"
    static let ledgerAddPath = "/ledger?add=1"

    /// ウィジェット・外部から渡された `assetmanager://…` を、アプリ内で開く相対パスへ変える（知らないURLは nil）
    static func appPath(forDeepLink url: URL) -> String? {
        guard url.scheme == authCallbackScheme, url.host == ledgerAddHost else { return nil }
        return ledgerAddPath
    }

    /// User-Agentの末尾に足す識別子（`AssetManagerIOS/1.0` の形）。サーバーログで見分けるためだけで、
    /// Web側の挙動はこの値で変えない。既定の `Mobile/…` は残したまま足す
    static var userAgentApplicationName: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        return "Mobile/15E148 AssetManagerIOS/\(version)"
    }

    /// このURLがアプリで開くべきWeb版の画面か（ホスト・スキーム・ポートまで一致）。
    /// 一致しないURLはWebViewへ読み込まず、Safari等で開く
    static func isAppURL(_ url: URL) -> Bool {
        url.scheme == baseURL.scheme && url.host == baseURL.host && url.port == baseURL.port
    }
}

/// WebViewの遷移のうち、アプリが横取りして認証シートで行うもの。
///
/// Web側のボタンは変えない。`/login` の「Googleでログイン」はサーバーアクション
/// （`app/actions/auth.ts` の `signInWithGoogleAction`）がSupabaseの認可URL
/// （`<Supabaseのホスト>/auth/v1/authorize?provider=google&…`）へ遷移させるので、その遷移だけを捕まえる。
/// Googleは埋め込みWebView内のOAuthを `disallowed_useragent` で拒むため、認証画面はシートへ出す
enum InterceptedRoute: Equatable {
    /// Googleログイン。ログイン後の遷移先は、表示中の `/login?callbackUrl=…` から引き継ぐ
    case login

    static func classify(_ url: URL) -> InterceptedRoute? {
        guard !isAppURL(url), url.path == "/auth/v1/authorize" else { return nil }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard items.first(where: { $0.name == "provider" })?.value == "google" else { return nil }
        return .login
    }

    private static func isAppURL(_ url: URL) -> Bool { AppConfig.isAppURL(url) }

    /// 表示中の `/login?callbackUrl=…` から、ログイン後に開く画面（サイト内の相対パス）を取り出す
    static func loginNext(from currentURL: URL?) -> String? {
        guard let currentURL, AppConfig.isAppURL(currentURL), currentURL.path == "/login" else { return nil }
        let value = URLComponents(url: currentURL, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first(where: { $0.name == "callbackUrl" })?
            .value
        guard let value, value.hasPrefix("/"), !value.hasPrefix("//") else { return nil }
        return value
    }
}
