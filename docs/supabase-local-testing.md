# Supabaseに依存しないローカル画面確認

## 背景

以前のローカル開発用Supabaseプロジェクトが削除され、`.env.local`に実値がないworktreeでは
ミドルウェアがSupabaseクライアントを作る時点で500になり、ログイン画面も確認できませんでした。
単体テストとCIビルドはSupabaseへ接続しないため通りますが、ログイン後の画面確認は別の導線が必要です。

## 使い方

1. `npm run db:setup`でローカルDBを準備する
2. `npm run dev`で開発サーバーを起動する
3. `http://localhost:3000/login`を開く
4. 「開発用ダミーユーザーでログイン」を押す

POST `/api/dev/login`は固定IDのダミーユーザーをローカルDBへupsertし、HttpOnly Cookieを発行します。
ミドルウェアと`getCurrentUser()`の両方がCookieを検証するため、Supabaseへの通信なしで保護画面を確認できます。

安全条件は次の2つです。

- `NODE_ENV=production`では、シークレットが設定されていてもバイパスを常に無効にする
- `CI_LOGIN_BYPASS_SECRET`が未設定、またはCookie値が一致しない場合は無効にする

`npm run dev`はシークレットを起動ごとにランダム生成します。自動確認で値を固定したい場合だけ、
`.env.local`へ`CI_LOGIN_BYPASS_SECRET`を設定します。本番環境には設定しません。

## 他リポジトリの調査（2026-09-21）

`guchi-apps`配下でSupabase設定を参照するアプリを静的に調査しました。

| 状態 | リポジトリ | 結果 |
| --- | --- | --- |
| 開発用ログインあり | `aide-bot`、`issue-deck`、`research-desk` | Supabase実値なしでログイン後画面を確認可能 |
| CIプレースホルダーのみ | `car-care`、`dayspan`、`db-console`、`meisai-lab`、`ops-dashboard`、`trainroute` | CIビルドは可能だが、OAuth背後の画面確認には実Supabaseまたは開発用ログインが必要 |
| API／限定利用 | `aide`、`myroom`、`portfolio` | Supabase参照はあるが、今回と同じNext.js保護画面の構成ではないため個別判断が必要 |

CIのダミーURLとキーは、SDKの初期化やビルドを通すだけです。ダミーJWTはSupabaseのJWKS検証時に
外部通信が必要になるため、ログイン後の画面確認の代替にはなりません。影響のあるリポジトリへ
横展開する場合は、本実装と同様に「本番での無効化」「専用Cookie」「ユーザー解決側の同時対応」を行います。
