import AuthenticationServices
import CryptoKit
import Security
import UIKit

/// 認証シート（ASWebAuthenticationSession）の結果。
enum NativeAuthResult {
    /// 戻り先のURL（`assetmanager://…`）。中身の解釈は呼び出し側が行う
    case callback(URL)
    case failed
    case cancelled
}

/// PKCEのverifier/challenge。ログインの引き継ぎコードは、アプリだけが持つ `verifier` が無ければ消費できない。
struct PKCEPair {
    let verifier: String
    let challenge: String

    init() {
        var bytes = [UInt8](repeating: 0, count: 48)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        precondition(status == errSecSuccess, "乱数を生成できませんでした")
        // 48バイト → base64url 64文字（RFC 7636 の43〜128文字）
        verifier = Data(bytes).base64URLEncoded
        challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncoded
    }
}

extension Data {
    var base64URLEncoded: String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// Googleのログインを iOS 標準の認証シートで行う（#1106。Morrow #441 と同じ方式）。
///
/// Googleは埋め込みWebViewでのログインを `disallowed_useragent` で拒むため、認証画面だけをシートへ出す。
/// **シートは毎回エフェメラル**（`prefersEphemeralWebBrowserSession = true`）。Safariの既存セッションを
/// 上書きせず、Safari共有のCookieでログイン経路が混線することも無い（代わりに毎回Googleの入力が要る）。
///
/// シートとWKWebViewはCookieを共有しない。アプリが受け取るのは引き継ぎコードや結果の定型値だけで、
/// アクセストークン・リフレッシュトークンはこのクラスを通らない。
final class NativeAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func start(url: URL, completion: @escaping (NativeAuthResult) -> Void) {
        // 連打で2枚目のシートを出さない
        guard session == nil else { return }

        let session = ASWebAuthenticationSession(
            url: url,
            callback: .customScheme(AppConfig.authCallbackScheme)
        ) { [weak self] callbackURL, error in
            DispatchQueue.main.async {
                self?.session = nil
                completion(Self.result(callbackURL: callbackURL, error: error))
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = true
        self.session = session

        if !session.start() {
            self.session = nil
            completion(.failed)
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let windows = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
            return windows.first(where: \.isKeyWindow) ?? windows.first ?? ASPresentationAnchor()
        }
    }

    private static func result(callbackURL: URL?, error: Error?) -> NativeAuthResult {
        if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
            return .cancelled
        }
        guard let callbackURL else { return .failed }
        return .callback(callbackURL)
    }
}
