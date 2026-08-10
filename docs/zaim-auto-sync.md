# Zaim Web 自動取得

Issue #145 の自動取得は、Zaim APIではなくPlaywrightでZaim Webの残高画面を巡回して取得する。

## 方針

- ZaimのID・パスワードはAsset Managerに保存しない
- 初回だけブラウザで手動ログインし、Playwrightのstorage stateを保存する
- 定期同期ではstorage stateを再利用してヘッドレスChromiumから残高画面を開く
- 銀行・電子マネー等は残高画面から、証券は各証券詳細ページから個別銘柄ごとに取得する
- CAPTCHA、追加認証、セッション切れが発生した場合は自動回避せず、手動ログインをやり直す
- 取得した名称は既存の `Category.valuationAlias` と一致したものだけ評価額へ反映する
- 日付付き評価額の保存には既存の `upsertValuationChange` を利用する

## 1. Playwrightの準備

PlaywrightはNext.js本体のnpm依存には含めず、ブラウザを動かす端末/VPSへ別途インストールする。

```bash
npm install -g playwright
playwright install chromium
```

LinuxでChromiumのOS依存パッケージが不足する場合は、環境に応じてPlaywright公式の依存パッケージも導入する。

## 2. 初回ログイン

`.env.local` 等に以下を設定する。

```env
ZAIM_LOGIN_URL=https://zaim.net/
ZAIM_STORAGE_STATE_PATH=.zaim/storage-state.json
```

GUIを利用できるPCで次を実行する。

```bash
node scripts/zaim-login.mjs
```

開いたブラウザでZaimへログインし、残高画面まで移動する。ターミナルに戻ってEnterを押すとstorage stateが保存される。

`.zaim/` には認証済みCookie等が含まれるため、Gitにはコミットしない。本番VPSで利用する場合はstorage stateを安全な方法でVPSへ配置する。

## 3. 残高画面を設定

手動ログイン時に実際の残高一覧を表示したURLを `ZAIM_BALANCE_URL` に設定する。

```env
ZAIM_BALANCE_URL=https://...
```

ページのDOM構造を確認できる場合は、以下も指定することを推奨する。

```env
ZAIM_BALANCE_ROW_SELECTOR=
ZAIM_BALANCE_NAME_SELECTOR=
ZAIM_BALANCE_AMOUNT_SELECTOR=
```

3つすべてを指定すると、各行から名称と金額を直接抽出する。未指定の場合は、表示中DOMから「名称 + ¥金額」に見える小さなブロックを候補として抽出する。

## 4. 証券詳細ページを設定

証券は残高画面に口座の合計しか表示されないため、残高画面から証券詳細ページへのリンクを辿り、個別銘柄の評価額を取得する。

```env
ZAIM_SECURITIES_LINK_SELECTOR=
ZAIM_SECURITIES_HOLDING_ROW_SELECTOR=
ZAIM_SECURITIES_HOLDING_NAME_SELECTOR=
ZAIM_SECURITIES_HOLDING_AMOUNT_SELECTOR=
```

- `ZAIM_SECURITIES_LINK_SELECTOR` の未指定時は `a[href*="/securities/"]` を使用する。リンクは重複を除いた順に1ページずつ巡回する。
- holding側の3セレクタも、残高側と同じく未指定なら汎用抽出へフォールバックする。
- 巡回するページ数が増えるほど時間がかかるため、同期処理側のタイムアウトは5分としている。

取得結果は次のルールでまとめる。

- 残高画面と証券詳細ページに同じ名称がある場合は、証券詳細ページ側（個別銘柄）を優先する
- 複数の証券口座に同じ銘柄がある場合は評価額を合算する

## 5. Asset Managerとの対応付け

評価額入力画面の表示設定にある `valuationAlias` に、Zaim画面上の名称を設定する。銀行・電子マネー等は残高画面の口座名を、証券は詳細ページに表示される個別銘柄名を設定する。

同期処理はZaim側名称と `valuationAlias` を対応付ける。ZaimのDOMは名称の途中で要素が分かれて空白・改行が混ざることがあるため、比較時は空白をすべて除去する（`楽天カー ド` と `楽天カード` は一致する）。一致しない項目は保存せず、APIレスポンスの `unmatched` に返す。

## 6. 手動同期

以下の環境変数を設定する。

```env
ZAIM_SYNC_SECRET=<十分に長いランダム文字列>
ZAIM_SYNC_USER_EMAIL=<Asset Managerのユーザーメールアドレス>
```

同期は次のエンドポイントから実行する。

```bash
curl -X POST \
  -H "Authorization: Bearer $ZAIM_SYNC_SECRET" \
  https://<asset-manager>/api/zaim/sync
```

成功時は `updated`、`skipped`、`unmatched` をJSONで返す。

## 7. 定期実行

手動同期が安定した後、cronなどから同じPOSTエンドポイントを定期的に呼び出す。

セッション切れの場合は同期を失敗させる。`scripts/zaim-login.mjs` で再ログインし、新しいstorage stateへ差し替えてから再開する。

## セキュリティ

- `.zaim/storage-state.json` はパスワード相当の秘密情報として扱う
- Web公開ディレクトリには置かない
- Gitへコミットしない
- 同期エンドポイントは `ZAIM_SYNC_SECRET` のBearer認証を必須とする
- Zaim側で追加認証やCAPTCHAが表示された場合、それを回避する自動化は行わない
