# Zaim Web 自動取得

Issue #145 の自動取得は、Zaim APIではなくPlaywrightでZaim Webの残高画面を巡回して取得する。

## 方針

- ZaimのID・パスワードはAsset Managerに保存しない
- 初回だけブラウザで手動ログインし、Playwrightのstorage stateを保存する
- 取得は画面の「Zaimから取得」ボタンを押したときに実行し、storage stateを再利用してヘッドレスChromiumから残高画面を開く
- セッションが切れないよう、維持専用の軽量ジョブだけを定期実行する
- 銀行・電子マネー等は残高画面から、証券は各証券詳細ページから証券口座ごと・個別銘柄ごとに取得する
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

開いたブラウザでZaimへログインする。ログイン完了は自動で検知され、storage stateが保存されてブラウザが閉じる。Cookie名に依存せず、実際に残高画面を開けるかどうかで判定している。保存後に、同期間隔の判断に使うセッションCookieの残り有効期間を表示する。

`.zaim/` には認証済みCookie等が含まれるため、Gitにはコミットしない。本番VPSで利用する場合はstorage stateを安全な方法でVPSへ配置する。

## 3. 残高画面を設定

残高一覧を表示するURLとDOMセレクタを指定する。以下は 2026-08 時点の zaim.net で実際に動作を確認した値。

```env
ZAIM_BALANCE_URL=https://zaim.net/home
ZAIM_BALANCE_ROW_SELECTOR="section.box.home-balance div.col-xs-7.text.account-name"
ZAIM_BALANCE_NAME_SELECTOR=.name
ZAIM_BALANCE_AMOUNT_SELECTOR=.value
```

行・名称・金額の3つすべてを指定すると、各行から名称と金額を直接抽出する。未指定の場合は、表示中DOMから「名称 + ¥金額」に見える小さなブロックを候補として抽出する。

注意点。

- 値に空白を含む場合はダブルクォートで囲む。
- 残高が未取得の口座は金額欄が `-`（`div.value.zero`）になる。金額として読めないため同期対象から自動的に外れる。
- ポイント口座は別クラス（`div.col-xs-7.text.point-name`）で、金額も `28,062 pt ¥12,345 相当` という形式のため、上記セレクタでは取得しない。取り込む場合は行セレクタの追加に加えて、この形式から円換算額を取り出す処理も必要になる。
- 口座名が長いと `住信 SBI ネット銀行 投...` のようにDOM上で省略される。省略前の名称はDOMに存在しないため、`valuationAlias` には省略された表示どおりの文字列を設定する。

## 4. 証券詳細ページを設定

証券は残高画面に口座の合計しか表示されないため、残高画面から証券詳細ページへのリンクを辿り、個別銘柄の評価額を取得する。

```env
ZAIM_SECURITIES_LINK_SELECTOR=
ZAIM_SECURITIES_ACCOUNT_NAME_SELECTOR=h2
ZAIM_SECURITIES_HOLDING_TABLE_SELECTOR=table
ZAIM_SECURITIES_HOLDING_NAME_HEADERS=銘柄,ファンド名
ZAIM_SECURITIES_HOLDING_AMOUNT_HEADERS=評価額
```

- `ZAIM_SECURITIES_LINK_SELECTOR` の未指定時は `a[href*="/securities/"]` を使用する。リンクは重複を除いた順に1ページずつ巡回する。
- 証券口座名は `ZAIM_SECURITIES_ACCOUNT_NAME_SELECTOR` で詳細ページから取る。zaim.net では `h2` に口座名が入る。未指定時はリンクのテキストから金額部分を除いたものを使い、それも取れなければページタイトル、最後にURLを使う。
- 銘柄は表から取得する。zaim.net の証券詳細ページには列構成の異なる表が混在するため（`銘柄・保有株数・取得単価・現在値・評価額・評価損益` の6列と、`銘柄・評価額` の2列）、列位置は決め打ちにできない。ヘッダー行の見出しを見て、`ZAIM_SECURITIES_HOLDING_AMOUNT_HEADERS` に一致する列を評価額として使う。銘柄名の列は `ZAIM_SECURITIES_HOLDING_NAME_HEADERS` で決め、見つからない場合は先頭列を使う。
- 表以外のDOMになった場合は `ZAIM_SECURITIES_HOLDING_ROW_SELECTOR` / `_NAME_SELECTOR` / `_AMOUNT_SELECTOR` の3つを指定して上書きできる。どちらの方法でも取れない場合は汎用抽出へフォールバックする。
- 同じ銘柄が特定口座・NISA等で複数行に分かれることがあるため、同一口座内の同名銘柄は合算する（`口座名/銘柄名` が一意になる）。
- 巡回するページ数が増えるほど時間がかかるため、同期処理側のタイムアウトは5分としている。

## 5. Asset Managerとの対応付け

評価額入力画面の表示設定にある `valuationAlias` に、Zaim画面上の名称を設定する。同期処理は次の優先順位で対応付ける。

| 優先 | `valuationAlias` に書く値 | 対象 |
| --- | --- | --- |
| 1 | `口座名/銘柄名#N` | 同一口座内に同名の銘柄が複数行ある場合に、表示順のN行目を指定する |
| 2 | `口座名/銘柄名` | 同じ銘柄を証券口座ごとに別カテゴリで管理する場合（その口座の同名行の合計） |
| 3 | `銘柄名` | 同じ銘柄を口座をまたいで1カテゴリにまとめる場合（複数口座分を合算する） |
| 4 | 残高一覧の名称 | 銀行・電子マネー等。銘柄を反映していない証券口座の合計もここで扱う |

例えば SBI証券と楽天証券の両方で `eMAXIS Slim 全世界株式` を保有している場合、

- 口座ごとに分けたい → 2つのカテゴリにそれぞれ `SBI証券/eMAXIS Slim 全世界株式`、`楽天証券/eMAXIS Slim 全世界株式` を設定する
- まとめたい → 1つのカテゴリに `eMAXIS Slim 全世界株式` を設定する（両口座の評価額を合算する）

### 同一口座内に同名の銘柄が複数行ある場合

同じ証券口座で同じ銘柄を旧NISA・新NISA、つみたて投資枠・成長投資枠などに分けて保有していると、Zaimの証券詳細ページには**同じ銘柄名の行が複数並ぶ**。Zaimはどの行がどの口座区分かを表示せず、行の属性にも情報がないため、**表示順でしか区別できない**。

そのため `口座名/銘柄名#1`、`口座名/銘柄名#2` のように出現順を指定する。`#N` は証券詳細ページで上から数えた順番で、1始まり。

```
SBI 証券/eMAXIS Slim 全世界株式(オール・カントリー)#1
SBI 証券/eMAXIS Slim 全世界株式(オール・カントリー)#2
```

`unmatched` は、同名行が複数ある銘柄だけ `#N` 付きで返すため、そのまま貼り付けられる。同名行が1つしかない銘柄には `#N` を付けない。

**表示順が変わると対応がずれる。** 銘柄の新規購入や全額売却で行が増減した場合は、`dryRun` で `entries` を確認してから運用を再開する。Zaimが口座区分を表示するようになれば、順番指定に頼らない対応付けへ変更できる。

### 二重計上の防止

同じ資産を複数のカテゴリへ重複して反映しないよう、次のルールで上位に消費された項目を下位の候補から除外する。

- 銘柄を1件でも反映した証券口座は、残高一覧側の口座合計を対応付け対象から外す（`unmatched` にも出さない）
- ある銘柄の一部だけを `口座名/銘柄名` で対応付けた場合、残りの口座分は `銘柄名` だけの alias で合算しない（残りは `unmatched` として報告する）

### 名称の表記ゆれ

ZaimのDOMは名称の途中で要素が分かれて空白・改行が混ざることがあるため、比較時は空白をすべて除去する。`楽天カー ド` と `楽天カード`、`楽天証券 / eMAXIS Slim 全世界株式` と `楽天証券/eMAXIS Slim 全世界株式` はいずれも一致する。

`valuationAlias` は `,`・`、`・`|` 区切りで複数の名称を設定できる。1つのカテゴリに複数が一致した場合は合算する。

一致しない項目は保存せず、APIレスポンスの `unmatched` に返す。証券銘柄は `口座名/銘柄名` の表記で返るため、そのまま `valuationAlias` へ貼り付けられる。

## 6. 画面から取得する

評価額更新画面の「Zaimから取得」ボタンで取得する。取得は利用者が押したタイミングだけ実行され、定期的に評価額が書き換わることはない。

押すとZaimを巡回し、`valuationAlias` と対応付いた値を**評価額の入力欄へ反映する**。この時点ではDBへ保存しない。合計・前回差分を確認したうえで「保存」を押して確定する。想定と違う値が入っていれば、保存前に修正・破棄できる。

対応付かなかった項目は保存されない。何が取得できたかを一覧で確認したい場合は、後述のdry-runを使う。

巡回は証券口座の数に応じて時間がかかる（4口座・20銘柄で約12秒）。

## 7. コマンド・APIから取得する

対応付けの初期設定や動作確認には、DBへ書き込まないdry-runを使う。`unmatched` に返る名称を `valuationAlias` へ設定する作業を、一致がなくなるまで繰り返す。

```bash
# VPS・ローカルのコマンドライン（シークレット不要）
npx -y tsx scripts/zaim-sync.ts --dry-run
npx -y tsx scripts/zaim-sync.ts
```

`ZAIM_SYNC_USER_EMAIL` か `ZAIM_BALANCE_URL` が未設定の場合は、何もせず正常終了する。

HTTP経由でも実行できる。cron等から呼ぶ場合はこちらを使う。

```env
ZAIM_SYNC_SECRET=<十分に長いランダム文字列>
ZAIM_SYNC_USER_EMAIL=<Asset Managerのユーザーメールアドレス>
```

```bash
curl -X POST -H "Authorization: Bearer $ZAIM_SYNC_SECRET" \
  "https://<asset-manager>/api/zaim/sync?dryRun=1"
```

`entries` に「どのカテゴリへ、Zaim側のどの名称から、いくら反映されるか」が、`unmatched` に「どの alias にも一致しなかった名称」が返る。`dryRun` を外すと実際に保存する。成功時は `updated`、`skipped`、`unmatched`、`entries` をJSONで返す。

## 8. セッション維持

### なぜ必要か

2026-08 時点で実測した各Cookieの役割は次のとおり。

| Cookie | ドメイン | 有効期間 | 役割 |
| --- | --- | --- | --- |
| `_y` | zaim.net | 2時間（**アクセスのたびに延長**） | Zaimのセッション。これがあれば巡回できる |
| `kf` | zaim.net | 約1時間（延長されない） | ログイン処理で発行される。巡回には不要 |
| `kufu` | id.kufu.jp | 約1時間（延長されない） | くふうIDの認証。巡回には不要 |

重要なのは `_y` だけで、**アクセスするたびに有効期限がその時点から2時間後へスライドする**。`kf` と `kufu` が失効して消えたあとでも巡回できることを確認している。

そのため巡回に成功するたびに、更新後のCookieをstorage stateへ保存し直している。

問題は、取得を画面のボタン任せにすると**前回から2時間以上空いた時点で必ず失効する**こと。失効すると `id.kufu.jp/signin` へリダイレクトされ `ZAIM_SESSION_EXPIRED` で失敗し、復旧にはGUIのある端末での再ログインが必要になる。VPS上ではこれを自動で行えない。

### 維持専用ジョブ

そこでPM2のcronで `scripts/zaim-keep-alive.mjs` を1時間ごとに実行する（`ecosystem.config.js` の `asset-manager-zaim-keep-alive`）。残高画面を1ページ開いてCookieを保存し直すだけで、評価額の取得も保存も行わない。

**間隔を1日1回にはできない。** 有効期間が2時間のため、24時間後には必ず失効している。90分でも1回失敗すると次回が3時間後になり失効するため、1回の失敗を吸収できる1時間を採用している。

`ZAIM_BALANCE_URL` が未設定の場合は何もせず正常終了するため、未設定の環境へデプロイしても失敗しない。

### VPSでの準備

VPSにも初回だけ次の準備が必要になる。

1. Playwrightとchromiumをインストールする（「1. Playwrightの準備」と同じ）
2. GUIのある端末で `node scripts/zaim-login.mjs` を実行し、生成された `.zaim/storage-state.json` をVPSのアプリディレクトリへ安全な方法で配置する
3. `ZAIM_*` をVPSの `.env` に設定する（デプロイで `.env` は削除されないが、GitHub Actions経由で配布する場合は1Passwordへの項目追加と `.github/deploy.env.tpl`・`deploy.yml` への追記が必要）

`.zaim/` はデプロイ時のクリーンアップ対象に含まれないため、配置後はデプロイしても残る。

## セキュリティ

- `.zaim/storage-state.json` はパスワード相当の秘密情報として扱う
- Web公開ディレクトリには置かない
- Gitへコミットしない
- 同期エンドポイントは `ZAIM_SYNC_SECRET` のBearer認証を必須とする
- Zaim側で追加認証やCAPTCHAが表示された場合、それを回避する自動化は行わない
