# Supabaseユーザーとアプリ内Userの対応付け（Issue #641）

## 何が起きていたか（2026-10-06）

利用者から「ログインできない」と報告された。本番のPM2ログでは `AuthApiError`（400 / `refresh_token_not_found`）が
繰り返し出ていたが、これは**古いセッションの更新に失敗した**ことしか示さない。ログイン不能の段階を分けると次のとおり。

| 段階 | 修正前の挙動 | 修正後 |
|---|---|---|
| 1. 古いセッションの更新（middleware） | 更新失敗でauth-jsがCookieを消すが、`/login`へのリダイレクト応答に載せていなかったため、無効なCookieが残り続け、リクエストのたびに400を繰り返す | 削除のCookieをリダイレクト応答へ載せ替える |
| 2. 新しいOAuthの完了（`/auth/callback`） | メールでUserを探し、`supabaseUserId`が**空のときだけ**書き込む。旧IDが残っていると新IDへ紐付かない | 確認済みメールなら`User.id`を保って付け替える |
| 3. 現在ユーザーの解決（`getCurrentUser`） | Supabaseのセッションは有効なのにUserが見つからず、資産が1件も無い空の画面（サイドバーも出ない）になる。エラーも出ない | `app/layout.tsx` が `/auth/account-link` へ回し、同じ判定で付け替えるか、セッションを破棄して`/login`へ戻す |

段階2・3は、Supabaseのユーザーが削除・再作成されて**同じGoogleアカウントでも`user.id`が変わった**ときに起きる
（共有Supabaseを使う他アプリで、認可拒否時にSupabaseユーザーを削除する実装があった。guchi-apps/issue-deck#4071）。
今回の本番障害がどの段階で止まっていたかは、本番のログ（`[auth/callback]`・`[auth]` で始まる行）と
DB上の`User.supabaseUserId`で確認する。

## 再紐付けの規則（`lib/account-link.ts`）

1. `supabaseUserId` で見つかれば、そのUser（通常のログイン）
2. 見つからず同じメールのUserがあれば、**プロバイダ（Google）が確認したメール**と一致するときだけ
   `supabaseUserId`を付け替える。`User.id`・資産・取引・連携は変更しない
   - 根拠にするのは `user.identities[]` のうち `provider === "google"` かつ `identity_data.email_verified === true`
     のメールと、Supabase側の `email_confirmed_at`。`user_metadata` は本人が `updateUser()` で書き換えられるので使わない
3. どちらも無ければ新規作成（ダミーデータを入れるのはこのときだけ）

付け替えは `updateMany({ where: { id, supabaseUserId: 旧値 } })` の条件付き更新で行い、同時に別のリクエストが
書き換えた場合や一意制約違反（P2002）は読み直して最大3回まで判定し直す。確定できない（`conflict`）・
確認できない（`unverified`）ときは**何も変更せず**、このアプリのセッションだけを破棄（`scope: "local"`）して
`/login?error=account_link` へ戻す。DBの保存に失敗したときは `/login?error=save_failed`。
Supabaseユーザーの削除・全アプリのセッション破棄・User削除・データ初期化は、どの経路でも行わない。

**通信不達と無効なセッションを混同しない。** `AuthRetryableFetchError`・429は `lib/auth-errors.ts` の
`isAuthUnreachable` で「今は確認できない」と判定し、middlewareは503、コールバックは `error=unreachable` を返す。
古いrefresh token（400）はセッション無効として扱い、再ログインへ進める。

## 管理された復旧（`error=account_link` が出続ける場合）

自動では付け替えない状況（Googleがメールを確認していない、別のメールでログインした、など）。
本人であることを利用者に確認したうえで、本番DBの該当Userの `supabaseUserId` だけを、Supabaseの管理画面
（Authentication → Users）で確認した現在のユーザーIDへ更新する。**Userを削除して作り直したり、新しいUserへ
データを移したりしない**（`User.id`を外部キーに持つテーブルが多数ある）。
同じ`supabaseUserId`を別のUserが持っている場合は一意制約で失敗するので、どちらが本人のデータかを先に確かめる。

## ローカルでの確かめ方（Supabaseの実値が無くてもよい）

Supabase Authの応答を返すだけの小さなHTTPサーバーを立て、`NEXT_PUBLIC_SUPABASE_URL` をそこへ向けると、
middleware・レイアウト・`/auth/account-link` を実物のままローカルDBに対して通せる（#641で実施）。

- `POST /auth/v1/token?grant_type=refresh_token` → `400 {"error_code":"refresh_token_not_found"}`
- `GET /auth/v1/user` → `Authorization` のトークンに応じてユーザーJSON（`identities` を含める）を返す
- `POST /auth/v1/logout` → 204（`?scope=local` で呼ばれることも確認できる）

Cookieは `sb-<ホスト名の先頭ラベル>-auth-token=base64-<セッションJSONのbase64url>`（`127.0.0.1` なら `sb-127-auth-token`）。
`expires_at` を過去にすると更新（＝400）を、未来にすると `/user` の照会だけを起こせる。

**`npm run dev` の前に環境変数を渡しても効かない。** `scripts/with-local-env.sh` が `.env.local` を `source` し、
空の `NEXT_PUBLIC_SUPABASE_URL=` で上書きするため。ラッパーの内側で渡す。

```bash
bash scripts/with-local-env.sh env PATH="$PWD/node_modules/.bin:$PATH" \
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9799 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=dummy \
  bash scripts/next-dev.sh
```
