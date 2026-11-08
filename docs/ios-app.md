# iOSアプリ（#1106）

Asset Manager を iPhone の独立したアプリとして配るための設計の判断をまとめる。ビルド・配布・実機確認の手順は
[ios/README.md](../ios/README.md)。

## 方式: WKWebView の薄い殻

Morrow（#441）・IssueDeck・YoteiFlow・kurashio と同じく、SwiftUI + `WKWebView` で本番のWeb版を開くだけにした。

- 画面・機能・データはWeb版が正本。Webの更新はアプリを出し直さなくても次の起動から反映される
- アプリの殻（`ios/`）を変えたときだけ TestFlight へ上げ直す
- Capacitor 等のハイブリッド基盤は採らない（新しい依存が要り、ほかのアプリと構成が揃わない）

## どこをネイティブにしたか

| 機能 | 実装 | 理由 |
|---|---|---|
| Googleログイン | ネイティブ（`ASWebAuthenticationSession`） | Googleは埋め込みWebViewのOAuthを `disallowed_useragent` で拒む |
| ログインの引き継ぎ | サーバー（`/auth/native/start`・`/auth/native/consume`・`NativeAuthHandoff`） | 認証シートと WKWebView は Cookie を共有しない |
| レシート撮影 | **Web版のまま**（`getUserMedia` と `<input type="file" capture>`） | 下記 |
| 外部リンク | Safariへ渡す | アプリ内に他サイトを開かない |
| 通信失敗 | ネイティブの再試行画面 | WKWebView では Service Worker のオフライン表示が効かない |

### カメラをネイティブにしなかった理由

レシート撮影（`components/receipts/receipt-camera.tsx`）は、すでに `getUserMedia` の撮影画面と、使えないときの
`<input type="file" accept="image/*" capture="environment">`（標準カメラ）・写真の選択を持っている。WKWebView は
iOS 14.3 以降 `getUserMedia` に対応しており、アプリ側で次の3点を用意すれば同じ実装がそのまま動く。

1. `NSCameraUsageDescription`（無いとカメラに触れた時点でアプリが強制終了する）
2. `allowsInlineMediaPlayback = true`（無いと映像が全画面プレーヤーになり、撮影ボタンが押せない）
3. `WKUIDelegate.requestMediaCapturePermissionFor` で、同一オリジンのカメラだけを許す（WebKitの確認を毎回出さない）

撮った画像はWeb版と同じく縮小（`lib/receipt-image-resize.ts`）してサーバーアクションへ送るので、解析・保存の経路も変わらない。

ネイティブのカメラ画面（VisionKit の書類スキャナー等）は、撮った画像をWeb側のアップロードへ渡す橋（JSブリッジか
専用のアップロードAPI）を新しく作る必要があり、初版としては大きい。実機でWebのカメラが撮りにくいと分かったら後続Issueにする。

## ログインの引き継ぎ

Morrow #441 と同じ「一度限りのコード + PKCE」だが、**アプリからのログインであることを `redirectTo` のクエリではなく
Cookie（`auth_native`）で運ぶ**点が違う。このリポジトリでは、クエリ付きの `redirectTo` が Supabase の Redirect URLs との
照合に失敗して Site URL へ落ちたことがあり、`next` も Cookie（`auth_next`）で運んでいる（`app/actions/auth.ts`）。
認証シートは `/auth/native/start` から `/auth/callback` までを同じブラウザコンテキストで進むので、Cookie は届く。
エフェメラルなシートなので、`auth_native` が Safari や WKWebView に残ることも無い。

- 発行: `/auth/callback` が `auth_native` を見つけたら、`linkAuthenticatedUser`（Web版と同じ）のあとにトークンを
  `lib/native-auth/cipher.ts` で暗号化して `NativeAuthHandoff` へ60秒だけ置き、コードだけを `assetmanager://auth-callback` へ返す
- 消費: WKWebView から `POST /auth/native/consume`。コードを先に使用済みにしてから verifier を照合する（不一致でもコードは燃える）
- 暗号鍵 `NATIVE_AUTH_HANDOFF_KEY` は専用のランダム値（1Password `apps/asset-manager/native-auth-handoff-key`）。
  未設定ならアプリからのログインだけが失敗し、Web・PWAのログインには影響しない

## 後続

- TestFlight 配布のCI（Morrow・IssueDeck の `ios-testflight.yml` / `ios-testflight-trigger.yml` / `ios-rebuild-notice.yml`）
- ネイティブのカメラ画面（実機でWeb版の撮影が使いにくい場合）
- 共有メニューからレシート画像・メールを渡す、iPad対応、プッシュ通知
