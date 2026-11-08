# Asset Manager iOSアプリ

本番Asset Manager（`https://asset.gucchii.com/`）をiPhoneの独立したアプリとして開くための、SwiftUI + WKWebView の薄い殻です（#1106）。
**画面・機能・データはすべてWeb版（既存サーバー）が正本**で、ここには「Web版を開く・Googleログインを認証シートで往復させる・レシート撮影にカメラを渡す・通信できないときに再試行させる」ことしか書いていません。Web/PWA版の挙動は変えていません。方式・署名・配布手順は Morrow・IssueDeck・YoteiFlow・kurashio の `ios/` と同じ構成です（設計の判断は [docs/ios-app.md](../docs/ios-app.md)）。

| 項目 | 値 |
|---|---|
| 表示名 | Asset Manager（PWAの `manifest.json` と同じ） |
| Bundle ID | `com.gucchii.assetmanager` |
| 署名 | Automatic（Apple Developer Program のチーム `6AA3WFTR94`。ほかのiOSアプリと同じチーム） |
| 対応 | iPhone・縦向き・iOS 18以上 |
| 認証シートの戻り先 | `assetmanager://auth-callback` 。URLスキームは `ios/Info-URLTypes.plist`（`INFOPLIST_FILE`）で登録する。plist は同期グループ（`ios/AssetManager`）の外に置くこと |
| カメラ | 使う（レシート撮影）。`NSCameraUsageDescription` と WebView のカメラ許可（同一オリジンだけ） |
| Associated Domains / Push / App Group | 使わない（初版スコープ外） |

## 更新が要る場所

| 変えたもの | Web/PWA | iOSアプリ |
|---|---|---|
| 画面・機能・サーバー（`app/`・`components/`・`lib/` など） | mainへマージ → 自動デプロイ | 何もしなくてよい（次に開いたとき新しい画面が出る） |
| アプリの殻（`ios/`） | 影響なし | Xcodeで入れ直す／TestFlightへ新しいビルドを上げる |

## ビルド方法（Mac + Xcode）

**subpc には Xcode が無い**ため、ビルド・実機確認はMacで行います。コミット前のコンパイル確認だけなら subpc から `ios/scripts/remote-build-check.sh`（作業ツリーの `ios/` をMacへ送り、署名なしで `xcodebuild`。署名・実機確認は含まない）。

1. Xcode 27系を使う（`project.pbxproj` は `objectVersion = 110`。古いXcodeでは開けない）
2. `open ios/AssetManager.xcodeproj`
3. スキーム `AssetManager`・実行先を自分のiPhoneにし、Signing & Capabilities の Team が Apple Developer Program のチームになっていることを確かめて ⌘R
4. 初回は iPhone の 設定 → プライバシーとセキュリティ → デベロッパモード をオンにし、設定 → 一般 → VPNとデバイス管理 で開発者証明書を信頼する

## TestFlight で配布する

初版は **Mac からの手動アップロード** だけです。mainへのデプロイ後に GitHub Actions（macOSランナー）が自動で配る仕組み（Morrow・IssueDeck の `ios-testflight.yml`）は後続Issueで入れます。

| 項目 | 値・運用 |
|---|---|
| App Store Connect のアプリ | 名前 `Asset Manager`・Bundle ID `com.gucchii.assetmanager`・チーム `6AA3WFTR94`（初回だけ手作業） |
| 輸出コンプライアンス | `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO`（標準のHTTPS通信のみ） |
| アイコン | `AppIcon.appiconset` の1024px（アルファ無し）。`public/icon.svg` の角丸を外して書き出したもの |
| 版番号（`MARKETING_VERSION`） | `package.json` の `version` と揃える。リリースの版上げ（`npm version`）が `package.json` の `scripts.version` から `sync-version.mjs` を実行して同じコミットへ含める。手動でも `node ios/scripts/sync-version.mjs`（冪等）。ずれていると `npm test` と `check-consistency.mjs` が落ちる |
| ビルド番号（`CURRENT_PROJECT_VERSION`） | アップロードのたびに増える必要がある。手動スクリプトが Archive 時に日時（`YYYYMMDDHHMM`）で上書きする（`IOS_BUILD_NUMBER` で固定も可） |

### 初回だけ（手作業・本人の操作）

1. [App Store Connect](https://appstoreconnect.apple.com/) → マイApp → 「+」→ 新規App。プラットフォーム iOS・名前 Asset Manager（使えなければ別名でよい。ホーム画面の表示名は `CFBundleDisplayName` が決める）・プライマリ言語 日本語・Bundle ID `com.gucchii.assetmanager`・SKU は任意（例 `assetmanager`）。Bundle ID が候補に出ない場合は Developer サイトの Identifiers で `com.gucchii.assetmanager` を先に登録する
2. App Store Connect API キーは**新しく作らず共用**する（APIキーはチーム単位）。1Password の `apps/AppStoreConnect` の `key-id`・`issuer-id`・`key-p8` を `ios/asc.env.tpl` が参照している
3. TestFlight →「内部テスト」にグループを作り、自分を追加
4. Mac の `~/apps/asset-manager` へこのリポジトリをチェックアウトする

### ビルドを上げるたび（subpc から1コマンド）

**Web側が main へデプロイされた後に**、`main` から上げます（ログインの引き継ぎ `/auth/native/*` が本番に無いと、アプリからログインできない）。

```bash
node ios/scripts/sync-version.mjs          # 版番号を package.json に揃える（通常は版上げで揃っている）
ios/scripts/remote-upload-testflight.sh    # Mac で main を取り込み、TestFlight へ上げる
```

- Mac 側の前提: チェックアウトが `$HOME/apps/asset-manager` にある（別の場所なら `MAC_REPO_DIR='$HOME/x'`）・Xcode・1Password CLI（`op`）にサインイン済み・ログインキーチェーンが開いている
- `MAC_HOST`（既定 `guchimac-mini`）・`MAC_REPO_DIR`・`IOS_BRANCH`・`IOS_SKIP_PULL=1`・`IOS_BUILD_NUMBER` を環境変数で上書きできる。作業ツリーに未コミットの変更があると中止する
- Mac の前にいるなら `op run --env-file=ios/asc.env.tpl -- ios/scripts/upload-testflight.sh`
- スクリプトは `check-consistency.mjs` → `xcodebuild archive` → `xcodebuild -exportArchive`（App Store Connect へ直接アップロード）を順に実行し、**どれかが失敗したらそこで止まる**。**終了コードをパイプで隠さないこと**（`| tee` 等を付けない）
- **subpc からは実行結果を確かめられない**。初回は Mac で1回通して確かめる

## 開発環境と本番の切り替え

`AssetManager/AppConfig.swift` の `baseURL` だけを変えます。LAN IP の `http://` のままでは Supabase Auth のリダイレクトが戻れないため、`https://asset-dev.minagu.work` や sslip.io のホスト名を使います。開発サーバー側にも `NATIVE_AUTH_HANDOFF_KEY`（任意のランダム文字列）が要ります。**戻すのを忘れてコミットしないこと**（`node ios/scripts/check-consistency.mjs` と `npm test` が本番URLかを確かめます）。

## Supabase側の設定

**新しく登録するURLは不要**です。認証シートが開くのは Web版の `/auth/native/start` で、Supabase・Google に返るのは既存の `https://asset.gucchii.com/auth/callback`（Web版と同じ・クエリ無し）だけです。アプリからのログインであることはクエリではなくCookie（`auth_native`）で運ぶので、Redirect URLs の許可リストとの照合はWeb版と変わりません。`assetmanager://` へ戻すのはサーバーで、許可リストには登録しません。

## 仕組み

### Googleログイン（認証シート → 引き継ぎコード → WebView）

`ASWebAuthenticationSession` と `WKWebView` は Cookie を共有しません。Asset Manager のログインは `@supabase/ssr` の Cookie セッションなので、次の方式でWebViewへ引き継ぎます。**認証シートは毎回エフェメラル**（Safariの既存ログインに触れない代わりに、毎回Googleの入力が要る）。

1. Web の `/login` の「Googleでログイン」はサーバーアクションが Supabase の認可URL（`…/auth/v1/authorize?provider=google`）へ遷移させる。アプリはこの遷移を捕まえてWebView内では開かない（Googleは埋め込みWebViewでのログインを拒む）。**Web側のボタンは変えない**
2. アプリが PKCE の `verifier`（乱数）と `challenge`（S256）を作り、認証シートで `/auth/native/start?challenge=…&next=…` を開く。`next` は表示中の `/login?callbackUrl=…` から取る
3. `/auth/native/start` は `challenge`・`next` を短命のhttpOnly Cookie（`auth_native`・10分）へ入れて Google へ送る。Google → Supabase → サーバーの `/auth/callback`。**Userへの対応付け（`linkAuthenticatedUser`）は Web版と同じ箇所**で行い、対応付けられなければ `assetmanager://auth-callback?error=not_allowed`
4. サーバーはセッションのトークンを暗号化して60秒だけDB（`NativeAuthHandoff`）へ置き、**トークンではなく一度限りのコード**だけを `assetmanager://auth-callback?code=…` で返す。暗号鍵は `NATIVE_AUTH_HANDOFF_KEY`
5. アプリはWebViewの中から `POST /auth/native/consume`（本文に `code` と `verifier`）を呼び、通常の Supabase SSR Cookie を受け取ってから `next` を開く（ここでもUserへの対応付けを確かめ直す）

使用済み・期限切れ・別用途・verifier不一致のコードはすべて同じ拒否。トークンは、URL・アプリのログ・Swiftのコードのどこにも出ません。コードは `verifier` が無ければ消費できないので、他のアプリが `assetmanager://` を横取りしてもログインできません。取消はログイン画面を開き直し、失敗はWeb版と同じ文言（`/login?error=auth|unreachable|account_link`）を出して、もう一度ログインを試せます。

### ログアウト・セッション失効

ログアウトは Web の画面操作のまま（`scope: "local"`）で、このアプリのセッションだけを終わらせます。共有Supabaseの他アプリ・他端末はログアウトされません。セッション失効は middleware が `/login` へ戻します。ログイン状態は WKWebView の既定データストアに残り、再起動しても維持されます。

### カメラ（レシート撮影）

レシート撮影（`components/receipts/receipt-camera.tsx`）は Web版のまま動かします。ネイティブのカメラ画面は作っていません（理由は [docs/ios-app.md](../docs/ios-app.md)）。

- 撮影画面の映像は `getUserMedia` → `<video playsInline muted autoPlay>`。WKWebView は `allowsInlineMediaPlayback = true` で、映像を画面内に出す（無いと全画面のプレーヤーになり撮影ボタンが押せない）
- WebView のカメラ許可（`requestMediaCapturePermissionFor`）は **Asset Manager と同一オリジンのメインフレームのカメラだけ** `.grant`。マイクとそれ以外は `.deny`。iOS 自体のカメラ許可は初回に一度だけ出る（`NSCameraUsageDescription`）
- 撮影画面の「写真から選ぶ」「標準カメラで撮る」は `<input type="file">`。WKWebView の標準の選択画面（写真ライブラリ・カメラ・ファイル）がそのまま開く。給与明細のPDF・家計簿のCSVの取り込みも同じ
- iOS の設定でカメラを拒否した場合は、Web側が「カメラを使えません」と代替の取り込み方法を出す

### 外部リンク・通信失敗・ダイアログ

- Asset Managerと同一オリジン（スキーム・ホスト・ポート）だけをWebView内で開き、他はSafariで開く（`AppConfig.isAppURL`）
- 通信できない・5xx のときは `ConnectionErrorView` が理由と「再読み込み」を出す。回線が戻れば自動で読み直す
- `alert` / `confirm` は `WKUIDelegate` で実装（無いと確認が常に「キャンセル」になる。現状のWeb版はどちらも使っていない）

### オフライン表示について

WKWebView では Service Worker（`app/sw.ts`）を使えません。PWA の保存済み画面を使う仕組みはアプリ内では効かず、代わりに再試行の画面を出します。

## 実機確認（本人がMacとiPhoneで行う。未実施）

PRのマージとTestFlight確認は別です。**この表が埋まるまで #1106 の要件は満たしたことになりません。**

| 項目 | 結果（ビルド番号・バージョン） |
|---|---|
| Xcodeでビルドでき、Asset Managerの名称・アイコンでiPhoneに起動する | 未確認 |
| Googleでログインしてアプリに戻れる／取消でログイン画面に戻り再試行できる | 未確認 |
| 完全終了して開き直してもログインが保たれる／ログアウトで再ログインへ誘導される | 未確認 |
| レシート撮影: 初回にiOSのカメラ許可が出て、撮影画面の映像が画面内に出て撮影・取り込みできる | 未確認 |
| レシート撮影: 「写真から選ぶ」「標準カメラで撮る」で取り込める | 未確認 |
| カメラを拒否したとき、代替の取り込み方法が出る | 未確認 |
| 給与明細PDF・家計簿CSVのファイル選択ができる | 未確認 |
| 外部リンクがSafariで開く | 未確認 |
| 機内モードで再試行画面が出て、戻すと自動で読み込まれる | 未確認 |
| Safari・PWA・PCの既存ログインが今までどおり動く（アプリのログインでSafari側がログアウトされない） | 未確認 |
| TestFlightから初回インストールでき、上記が通る | 未確認 |

## 初版スコープ外（後続Issue）

TestFlight配布のCI自動化 / ネイティブのカメラ画面（VisionKitの書類スキャナー等） / ネイティブプッシュ通知 / 共有メニューからレシート画像を渡す機能 / ウィジェット / iPad対応 / App Store公開。
