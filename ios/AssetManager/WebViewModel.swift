import Combine
import Network
import os
import SwiftUI
import UIKit
import WebKit

/// Web版を開く WKWebView と、その読み込み状態を持つ。
final class WebViewModel: NSObject, ObservableObject {
    @Published private(set) var failure: LoadFailure?
    @Published private(set) var isRetrying = false

    let webView: WKWebView

    private let auth = NativeAuth()
    private let pathMonitor = NWPathMonitor()
    private var isNetworkAvailable = true
    private var hasStarted = false
    /// 最後に開こうとしたメインフレームのURL。読み込みに失敗すると `webView.url` は
    /// 直前に表示できていた画面のままなので、再試行はこちらを開き直す
    private var lastRequestedURL: URL?

    override init() {
        let configuration = WKWebViewConfiguration()
        // Cookie・localStorage（Supabaseのセッション）を端末に残し、再起動後もログインを保つ
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = AppConfig.userAgentApplicationName
        // レシートの撮影画面（components/receipts/receipt-camera.tsx）は getUserMedia の映像を
        // <video playsInline muted autoPlay> で画面内に出す。インライン再生を許さないと全画面の
        // プレーヤーに切り替わり、撮影ボタンが押せなくなる
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        // 読み込み前の一瞬に白い面が出ないよう、ヘッダーと同じ色を下地にする
        webView.isOpaque = false
        webView.backgroundColor = UIColor(named: "HeaderBand")
        webView.scrollView.backgroundColor = UIColor(named: "HeaderBand")
    }

    deinit {
        pathMonitor.cancel()
    }

    func startIfNeeded() {
        guard !hasStarted else { return }
        hasStarted = true

        pathMonitor.pathUpdateHandler = { [weak self] path in
            let available = path.status == .satisfied
            DispatchQueue.main.async { self?.networkChanged(available: available) }
        }
        pathMonitor.start(queue: .main)
        load(AppConfig.baseURL)
    }

    func retry() {
        isRetrying = true
        load(lastRequestedURL ?? AppConfig.baseURL)
    }

    private func load(_ url: URL) {
        lastRequestedURL = url
        webView.load(URLRequest(url: url))
    }

    /// アプリ内の相対パスを開く（絶対URL・他オリジンは無視して起動画面へ）
    private func loadAppPath(_ path: String) {
        guard let url = URL(string: path, relativeTo: AppConfig.baseURL)?.absoluteURL, AppConfig.isAppURL(url) else {
            load(AppConfig.baseURL)
            return
        }
        load(url)
    }

    private func networkChanged(available: Bool) {
        let recovered = available && !isNetworkAvailable
        isNetworkAvailable = available
        if recovered, failure == .offline { retry() }
    }

    private func fail(with error: Error) {
        let nsError = error as NSError
        // 別の読み込みに置き換わった・レスポンスを見て自分で止めた（5xx）場合は失敗扱いにしない
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled { return }
        if nsError.domain == "WebKitErrorDomain", nsError.code == 102 { return }

        isRetrying = false
        let offlineCodes: Set<Int> = [
            NSURLErrorNotConnectedToInternet,
            NSURLErrorNetworkConnectionLost,
            NSURLErrorDataNotAllowed,
            NSURLErrorInternationalRoamingOff,
        ]
        if !isNetworkAvailable || (nsError.domain == NSURLErrorDomain && offlineCodes.contains(nsError.code)) {
            failure = .offline
        } else {
            failure = .server(status: nil)
        }
    }

    private func openExternally(_ url: URL) {
        UIApplication.shared.open(url)
    }
}

// MARK: - 認証シートとの往復（ログイン）

extension WebViewModel {
    /// WebViewが横取りした遷移を、認証シートで行う。Web側のリンクは素の `<a>` のまま
    fileprivate func handle(_ route: InterceptedRoute) {
        switch route {
        case .login:
            startLogin(next: InterceptedRoute.loginNext(from: webView.url))
        }
    }

    /// Googleログイン。認証シートで `/auth/native/start` を開き、Google → Supabase → サーバーの
    /// `/auth/callback` と進んで、`assetmanager://auth-callback?code=<引き継ぎコード>` で戻る。
    /// コードは一度限り・60秒で、ここで持つ `verifier` が無ければ消費できない
    private func startLogin(next: String?) {
        let pkce = PKCEPair()
        var components = URLComponents(
            url: AppConfig.baseURL.appending(path: "auth/native/start"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [URLQueryItem(name: "challenge", value: pkce.challenge)]
        if let next { components?.queryItems?.append(URLQueryItem(name: "next", value: next)) }
        guard let url = components?.url else { return }

        auth.start(url: url) { [weak self] result in
            guard let self else { return }
            switch result {
            case .callback(let callbackURL):
                Task { await self.finishLogin(callbackURL: callbackURL, verifier: pkce.verifier) }
            case .failed:
                self.loadAppPath("/login?error=auth")
            case .cancelled:
                // ログインボタンは「Googleへ移動しています…」のまま止まっているので、ログイン画面を開き直す
                self.load(self.webView.url ?? AppConfig.baseURL)
            }
        }
    }

    private func finishLogin(callbackURL: URL, verifier: String) async {
        guard
            callbackURL.scheme == AppConfig.authCallbackScheme,
            callbackURL.host == "auth-callback",
            let items = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?.queryItems
        else {
            loadAppPath("/login?error=auth")
            return
        }

        // サーバーが返す失敗の種類（lib/native-auth/native-app.ts の NativeLoginError）を、
        // Web版の /login が表示できる値（app/login/page.tsx の LOGIN_ERROR_MESSAGES）へ寄せる
        switch items.first(where: { $0.name == "error" })?.value {
        case "not_allowed":
            loadAppPath("/login?error=account_link")
            return
        case "unreachable":
            loadAppPath("/login?error=unreachable")
            return
        case .some:
            loadAppPath("/login?error=auth")
            return
        case nil:
            break
        }
        guard let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty else {
            loadAppPath("/login?error=auth")
            return
        }

        // WebViewの中（ログインCookieが届く側）で消費する。コードとverifierはURLではなく本文で送る
        let script = """
        const response = await fetch('/auth/native/consume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ code: code, verifier: verifier })
        });
        if (!response.ok) { return { status: response.status }; }
        const body = await response.json();
        return { status: response.status, next: body.next };
        """
        let value = try? await webView.callAsyncJavaScript(
            script,
            arguments: ["code": code, "verifier": verifier],
            contentWorld: .page
        )
        let dictionary = value as? [String: Any]
        let status = dictionary?["status"] as? Int

        if status == 200, let next = dictionary?["next"] as? String {
            loadAppPath(next)
        } else if status == 403 {
            loadAppPath("/login?error=account_link")
        } else {
            loadAppPath("/login?error=auth")
        }
    }
}

// MARK: - 読み込み

extension WebViewModel: WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction
    ) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }

        if ["about", "blob", "data"].contains(url.scheme ?? "") { return .allow }

        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true

        // ログインの開始は、WebViewの中では行わず認証シートへ渡す
        if isMainFrame, let route = InterceptedRoute.classify(url) {
            handle(route)
            return .cancel
        }

        if AppConfig.isAppURL(url) {
            if isMainFrame { lastRequestedURL = url }
            return .allow
        }
        // 埋め込み（iframe）はそのまま。画面ごと他のサイトへ移るものはSafari等で開く
        if !isMainFrame { return .allow }
        openExternally(url)
        return .cancel
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse
    ) async -> WKNavigationResponsePolicy {
        // Apache の 502/503（バックエンドの再起動中など）を、素のエラーページのまま見せない
        if navigationResponse.isForMainFrame,
           let response = navigationResponse.response as? HTTPURLResponse,
           response.statusCode >= 500 {
            isRetrying = false
            failure = .server(status: response.statusCode)
            return .cancel
        }
        return .allow
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isRetrying = false
        failure = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail(with: error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail(with: error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // メモリ不足などでWebの描画プロセスが落ちると、白い画面のまま戻らない
        load(lastRequestedURL ?? AppConfig.baseURL)
    }
}

// MARK: - 新しいウインドウ・ダイアログ

extension WebViewModel: WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // target="_blank" のリンク。アプリの画面なら同じWebViewで、外部ならSafari等で開く
        if let url = navigationAction.request.url {
            if let route = InterceptedRoute.classify(url) {
                handle(route)
            } else if AppConfig.isAppURL(url) {
                load(url)
            } else {
                openExternally(url)
            }
        }
        return nil
    }

    /// `window.confirm()`（削除の確認など）。UIDelegateで実装しないと常に false が返り、実行できない
    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo
    ) async -> Bool {
        await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in continuation.resume(returning: false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in continuation.resume(returning: true) })
            guard present(alert) else { return continuation.resume(returning: false) }
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo
    ) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in continuation.resume() })
            guard present(alert) else { return continuation.resume() }
        }
    }

    /// レシート撮影の `getUserMedia`。Web版（同一オリジン）からのカメラだけを許し、WebKit側の確認を
    /// 毎回は出さない。iOS自体のカメラ許可（Info.plist の NSCameraUsageDescription）は初回に一度だけ出る。
    /// マイク（音声）はどの画面も使わないので許さない
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType
    ) async -> WKPermissionDecision {
        let base = AppConfig.baseURL
        let defaultPort = base.scheme == "https" ? 443 : 80
        let sameOrigin = origin.protocol == base.scheme
            && origin.host == base.host
            && (origin.port == 0 ? defaultPort : origin.port) == (base.port ?? defaultPort)
        let granted = frame.isMainFrame && sameOrigin && type == .camera
        // 許可の確認が出る原因の切り分け用（#1197）。呼ばれているか・何を返したかを Console.app で見る
        Logger(subsystem: "com.gucchii.assetmanager", category: "camera")
            .notice("requestMediaCapturePermission host=\(origin.host, privacy: .public) main=\(frame.isMainFrame) same=\(sameOrigin) type=\(type.rawValue) granted=\(granted)")
        return granted ? .grant : .deny
    }

    private func present(_ controller: UIViewController) -> Bool {
        guard var top = webView.window?.rootViewController else { return false }
        while let presented = top.presentedViewController { top = presented }
        top.present(controller, animated: true)
        return true
    }
}

/// SwiftUI に WKWebView を置くための入れ物。WebView 本体は WebViewModel が持ち続ける
struct WebViewContainer: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
