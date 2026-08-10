# Zaim Web 自動取得

Issue #145 の自動取得は、Zaim APIではなくPlaywrightで認証済みのZaim Webを巡回して評価額を取得する。

## 取得方針

- `/home` から銀行・電子マネーなどの残高を取得する。
- `/home` 内の `/securities/...` リンクを収集し、各証券詳細ページを順に開く。
- 証券詳細ページでは口座合計ではなく、個別銘柄名と評価額を取得する。
- 同じ名称が `/home` と証券詳細ページの両方にある場合、証券詳細ページの値を優先する。
- 複数の証券口座に同じ銘柄がある場合、その評価額を合算する。
- 取得名を既存の `Category.valuationAlias` と照合し、一致した評価対象だけを保存する。DOM上の空白・改行差は無視する。

## 1. Playwrightの準備とログイン

```bash
npm install -g playwright
playwright install chromium
```

```env
ZAIM_LOGIN_URL=https://zaim.net/
ZAIM_STORAGE_STATE_PATH=.zaim/storage-state.json
```

次を実行し、表示されたブラウザでZaimへログインして残高画面まで移動する。ターミナルに戻ってEnterを押すとstorage stateが保存される。

```bash
node scripts/zaim-login.mjs
```

`.zaim/` には認証済みCookie等が含まれるためGitへコミットしない。本番環境へは秘密情報として安全に配置する。

## 2. 残高・証券holdingの抽出設定

```env
ZAIM_BALANCE_URL=https://zaim.net/home

# /home の銀行・電子マネー等（3つすべてを指定する）
ZAIM_BALANCE_ROW_SELECTOR=
ZAIM_BALANCE_NAME_SELECTOR=
ZAIM_BALANCE_AMOUNT_SELECTOR=

# /home の証券詳細リンク。通常は未指定でよい
ZAIM_SECURITIES_LINK_SELECTOR=a[href*="/securities/"]

# 証券詳細ページの個別銘柄（3つすべてを指定する）
ZAIM_SECURITIES_HOLDING_ROW_SELECTOR=
ZAIM_SECURITIES_HOLDING_NAME_SELECTOR=
ZAIM_SECURITIES_HOLDING_AMOUNT_SELECTOR=
```

各組の3セレクタをすべて指定した場合は行から名称と金額を直接取得する。未指定の場合は、小さなDOMブロックから「名称 + `￥`/`¥`金額」を探す汎用抽出へフォールバックする。安定運用では実ページを確認してセレクタを設定することを推奨する。

抽出だけを確認するには次を実行する。JSONの `source` は `home` または `securityHolding`、`url` は取得元ページを示す。

```bash
node scripts/zaim-scrape.mjs
```

## 3. Asset Managerとの対応付け

評価額入力画面の表示設定で、`valuationAlias` にZaim上の名称を設定する。証券資産は証券口座名ではなく、詳細ページに表示される個別銘柄名を設定する。

```text
Category.name: 全世界株式
Category.valuationAlias: eMAXIS Slim 全世界株式（オール・カントリー）
```

名称比較では空白と改行を除去するため、DOM分割による `楽天カー ド` のような表示も `楽天カード` に一致する。一致しない取得項目は保存せず、同期APIの `unmatched` に返す。

## 4. 同期

```env
ZAIM_SYNC_SECRET=<十分に長いランダム文字列>
ZAIM_SYNC_USER_EMAIL=<Asset Managerのユーザーメールアドレス>
```

```bash
curl -X POST \
  -H "Authorization: Bearer $ZAIM_SYNC_SECRET" \
  https://<asset-manager>/api/zaim/sync
```

成功時は `updated`、`skipped`、`unmatched` をJSONで返す。手動同期が安定してからcron等で同じPOSTを定期実行する。セッション切れ時は同期を失敗させるため、`scripts/zaim-login.mjs` で再ログインする。

## セキュリティ

- ZaimのID・パスワードはAsset Managerへ保存しない。
- `.zaim/storage-state.json` はパスワード相当の秘密情報として扱う。
- 同期APIは `ZAIM_SYNC_SECRET` のBearer認証を必須とする。
- CAPTCHAや追加認証を自動回避しない。
