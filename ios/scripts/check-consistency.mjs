#!/usr/bin/env node
// サーバー（TypeScript）とiOSアプリ（Swift）で揃えておく値・判定が食い違っていないかを照合する。
// Xcodeの無い環境（subpc・CI）でも動く。`npm test` の `lib/ios-consistency.test.ts`
// が同じ関数を使う。単独でも `node ios/scripts/check-consistency.mjs` で実行できる。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => readFileSync(join(root, path), "utf-8");

/** 問題の一覧を返す（空なら整合している）。 */
export function checkConsistency() {
  const problems = [];
  const appConfig = read("ios/AssetManager/AppConfig.swift");
  const nativeApp = read("lib/native-auth/native-app.ts");
  const webViewModel = read("ios/AssetManager/WebViewModel.swift");
  const nativeAuth = read("ios/AssetManager/NativeAuth.swift");
  const pbxproj = read("ios/AssetManager.xcodeproj/project.pbxproj");
  const loginPage = read("app/login/page.tsx");

  const swiftScheme = appConfig.match(/authCallbackScheme = "([^"]+)"/)?.[1];
  const tsScheme = nativeApp.match(/NATIVE_SCHEME = "([^"]+)"/)?.[1];
  if (!swiftScheme || swiftScheme !== tsScheme) {
    problems.push(`戻り先スキームが一致しません: Swift=${swiftScheme} / TS=${tsScheme}`);
  }

  // 戻り先のホスト（auth-callback）
  for (const host of ["auth-callback"]) {
    if (!nativeApp.includes(`://${host}`)) problems.push(`native-app.ts に ${host} がありません`);
    if (!webViewModel.includes(`"${host}"`)) problems.push(`WebViewModel.swift に ${host} がありません`);
  }

  // 横取りするのは、Web版のログインボタンが遷移するSupabaseの認可URL（provider=google）
  for (const value of ["/auth/v1/authorize", "google", "callbackUrl"]) {
    if (!appConfig.includes(`"${value}"`)) problems.push(`AppConfig.swift に ${value} がありません`);
  }

  // アプリが /login へ付けるエラーの値は、Web版のログイン画面が表示できるもの
  for (const error of [...webViewModel.matchAll(/\/login\?error=([a-z_]+)/g)].map((m) => m[1])) {
    if (!new RegExp(`^\\s*${error}:`, "m").test(loginPage)) {
      problems.push(`app/login/page.tsx が error=${error} の文言を持っていません`);
    }
  }
  // 引き継ぎの経路
  for (const path of ["auth/native/start", "/auth/native/consume"]) {
    if (!webViewModel.includes(path)) problems.push(`WebViewModel.swift が ${path} を使っていません`);
  }

  // 同一オリジン判定は、スキーム・ホスト・ポートまで見る（Asset Manager外はWebViewへ読み込まない）
  if (!/url\.scheme == baseURL\.scheme && url\.host == baseURL\.host && url\.port == baseURL\.port/.test(appConfig)) {
    problems.push("AppConfig.isAppURL がスキーム・ホスト・ポートの一致を見ていません");
  }
  if (!/openExternally\(url\)\s*\n\s*return \.cancel/.test(webViewModel)) {
    problems.push("WebViewModel.swift が外部URLをSafariで開いて .cancel していません");
  }

  // レシート撮影（getUserMedia）はインライン再生とカメラの許可が要る
  if (!webViewModel.includes("allowsInlineMediaPlayback = true")) {
    problems.push("WebViewModel.swift がインライン再生を許していません（撮影画面の映像が全画面になる）");
  }
  if (!webViewModel.includes("requestMediaCapturePermissionFor")) {
    problems.push("WebViewModel.swift がカメラの許可（requestMediaCapturePermissionFor）を実装していません");
  }
  if (!pbxproj.includes("INFOPLIST_KEY_NSCameraUsageDescription")) {
    problems.push("Info.plist に NSCameraUsageDescription がありません（カメラを使うと強制終了する）");
  }

  // システムの確認ダイアログを日本語にするため、日本語のローカライズをバンドルへ含める（#1197）
  if (!/developmentRegion = ja;/.test(pbxproj) || !/knownRegions = \([^)]*\bja,/.test(pbxproj)) {
    problems.push("project.pbxproj の developmentRegion / knownRegions が ja になっていません（システムのダイアログが英語になる）");
  }
  let jaStrings = "";
  try { jaStrings = read("ios/AssetManager/ja.lproj/InfoPlist.strings"); } catch { /* 下で報告する */ }
  if (!jaStrings.includes("NSCameraUsageDescription")) {
    problems.push("ios/AssetManager/ja.lproj/InfoPlist.strings がありません（日本語のローカライズがバンドルに入らない）");
  }

  // 戻り先スキームはInfo.plistに登録されていないとアプリへ復帰できない（Debug/Release両方）
  const infoPlistRefs = pbxproj.match(/INFOPLIST_FILE = "?Info-URLTypes\.plist"?;/g) ?? [];
  if (infoPlistRefs.length < 2) problems.push("Debug/Release両方の INFOPLIST_FILE が Info-URLTypes.plist を指していません（認証コールバックのURLスキームが未登録になる）");
  let urlTypes = "";
  try { urlTypes = read("ios/Info-URLTypes.plist"); } catch { /* 下で報告する */ }
  if (!new RegExp(`CFBundleURLSchemes</key>\\s*<array>\\s*<string>${swiftScheme}</string>`).test(urlTypes)) {
    problems.push(`ios/Info-URLTypes.plist に CFBundleURLSchemes の ${swiftScheme} がありません`);
  }

  // 認証シートは毎回エフェメラル（Safariの既存セッションに触れない）
  if (!nativeAuth.includes("prefersEphemeralWebBrowserSession = true")) {
    problems.push("認証シートがエフェメラルではありません");
  }

  // Bundle ID・表示名
  if (!pbxproj.includes("PRODUCT_BUNDLE_IDENTIFIER = com.gucchii.assetmanager;")) problems.push("Bundle ID が com.gucchii.assetmanager ではありません");
  if (!pbxproj.includes('INFOPLIST_KEY_CFBundleDisplayName = "Asset Manager";')) problems.push("表示名が Asset Manager ではありません");

  // 版番号は package.json と揃える（node ios/scripts/sync-version.mjs）
  const { version } = JSON.parse(read("package.json"));
  const versions = [...pbxproj.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]);
  if (versions.length === 0 || versions.some((v) => v !== version)) {
    problems.push(`MARKETING_VERSION（${versions.join(", ")}）が package.json の ${version} と一致しません。node ios/scripts/sync-version.mjs を実行してください`);
  }

  // 開発用のURLをコミットしていない
  if (!/baseURL = URL\(string: "https:\/\/asset\.gucchii\.com\/"\)!/.test(appConfig)) {
    problems.push("AppConfig.baseURL が本番URLではありません（開発用のまま？）");
  }

  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkConsistency();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`✖ ${problem}`);
    process.exit(1);
  }
  console.log("iOSアプリとサーバーの整合: OK");
}
